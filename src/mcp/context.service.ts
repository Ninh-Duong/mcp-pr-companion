import { DataStore } from '../core/storage/data.store.js';
import { PRRegistry, ParsedPRUrl } from '../core/registry/pr.registry.js';
import { BitbucketCollector } from '../core/bitbucket/bitbucket.collector.js';
import { PRManifestV4 } from '../core/output/schema/manifest.v4.schema.js';
import { OutputReader } from '../core/output/output.reader.js';
import { FileIndexEntryV4 } from '../core/output/schema/file_index.v4.schema.js';
import { FileChangeV4 } from '../core/output/schema/file_change.v4.schema.js';
import { SecretScanner } from '../core/privacy/secret.scanner.js';
import { PIISanitizer } from '../core/privacy/pii.sanitizer.js';
import { PathSanitizer } from '../core/privacy/path.sanitizer.js';
import { ConfigManager } from '../config/config.manager.js';
import { PRDiscoveryService } from '../core/discovery/pr-discovery.service.js';
import { AccessGate } from '../core/auth/access-gate.js';
import pLimit from 'p-limit';
import { Logger } from '../utils/logger.js';

export interface Page {
  text: string;
  total_chars: number;
  /** Offset to pass for the next page, or null when this page reaches the end. */
  next_offset: number | null;
}

export interface FileFilters {
  path?: string;
  language?: string;
  status?: string;
  change_kind?: string;
  risk_tag?: string;
  limit: number;
}

type Head = Awaited<ReturnType<BitbucketCollector['getHeadCommits']>>;

const NOT_SYNCED ='PR is not synced yet. Call get_pr_context_pack for this pr_url first.';

/**
 * MCP-facing reads over the on-disk revision store (the single source of truth: no RAM cache).
 * Every file there is encrypted, so each entry point first calls AccessGate.unlock (one Bitbucket
 * request per repository per minute) before reading or writing.
 */
export class PRContextService {
  private static inFlight = new Map<string, Promise<PRManifestV4>>();

  static page(text: string, offset: number, maxChars: number): Page {
    const end = Math.min(text.length, offset + maxChars);
    return { text: text.slice(offset, end), total_chars: text.length, next_offset: end < text.length ? end : null };
  }

  /** Collects the PR and writes a new revision. Concurrent calls for one PR share one fetch, refresh or not. */
  static sync(pr: ParsedPRUrl, collector = new BitbucketCollector()): Promise<PRManifestV4> {
    const key = `${pr.workspace}:${pr.repoSlug}:${pr.prId}`;
    let task = this.inFlight.get(key);
    if (!task) {
      task = AccessGate.unlock(pr.workspace, pr.repoSlug)
        .then(() => collector.collect(pr.workspace, pr.repoSlug, pr.prId))
        .then(async raw => {
          await AccessGate.unlock(pr.workspace, pr.repoSlug); // a long download may outlive the unlock TTL
          return DataStore.saveRevision(pr.workspace, pr.repoSlug, pr.prId, raw).manifest;
        })
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, task);
    }
    return task;
  }

  /**
   * Re-syncs when there is no local revision, on refresh, or when the PR's source/target commits
   * moved since the last sync. The note explains a cached answer when freshness could not be checked.
   */
  static async ensureFresh(pr: ParsedPRUrl, refresh: boolean): Promise<{ status: 'synced' | 'unchanged' | 'offline'; note: string | null; head?: Head }> {
    // Outside the try: missing credentials, ALLOWED_EMAILS denial or no repository access must fail the call.
    const collector = new BitbucketCollector();
    await AccessGate.unlock(pr.workspace, pr.repoSlug);
    const active = refresh ? null : OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId);
    if (!active) {
      await this.sync(pr, collector);
      return { status: 'synced', note: null };
    }

    let head: Head;
    try {
      head = await collector.getHeadCommits(pr.workspace, pr.repoSlug, pr.prId);
    } catch (err) {
      const reason = SecretScanner.scanAndRedact(err instanceof Error ? err.message : String(err));
      return { status: 'offline', note: `Note: could not check Bitbucket for newer commits (${reason}); showing the revision synced at ${active.current.updated_at}.` };
    }
    if (head.source !== active.current.source_commit || head.destination !== active.current.target_commit) {
      await this.sync(pr, collector);
      return { status: 'synced', note: null, head };
    }
    return { status: 'unchanged', note: null, head };
  }

  static async getContextPack(prUrl: string, refresh: boolean, includeFileTable: boolean): Promise<string> {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    const { note, head } = await this.ensureFresh(pr, refresh);
    const context = OutputReader.getContextPack(pr.workspace, pr.repoSlug, pr.prId);
    if (!context) throw new Error('Context pack generation failed: context.md was not written.');

    // Approvals, builds and comments change without new commits, so they are summarized live and never stored.
    const parts = [note, context, await this.reviewStatusSection(pr, head), await this.reviewThreadsSection(pr)];
    if (includeFileTable) parts.push(OutputReader.getFilesSummary(pr.workspace, pr.repoSlug, pr.prId));
    return parts.filter(Boolean).join('\n\n---\n\n');
  }

  /** Unlocks the PR's repository (live access check) and requires a local revision. */
  private static async requireSynced(prUrl: string): Promise<ParsedPRUrl> {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    await AccessGate.unlock(pr.workspace, pr.repoSlug);
    if (!OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId)) throw new Error(NOT_SYNCED);
    return pr;
  }

  static async getFileContext(prUrl: string, fileId: string | number, offset: number, maxChars: number): Promise<Page> {
    const pr = await this.requireSynced(prUrl);
    const text = OutputReader.getFileContext(pr.workspace, pr.repoSlug, pr.prId, fileId);
    if (!text) throw new Error(`No file ${OutputReader.normalizeFileId(fileId)} in this PR. Use search_pr_files to list file ids.`);
    return this.page(text, offset, maxChars);
  }

  static async getFileChange(
    prUrl: string,
    fileId: string | number,
    includePatch: boolean,
    offset: number,
    maxChars: number
  ): Promise<{ change: FileChangeV4; patch?: Page }> {
    const pr = await this.requireSynced(prUrl);
    const detail = OutputReader.getFileChange(pr.workspace, pr.repoSlug, pr.prId, fileId);
    if (!detail) throw new Error(`No file ${OutputReader.normalizeFileId(fileId)} in this PR. Use search_pr_files to list file ids.`);
    return {
      change: detail.change,
      ...(includePatch ? { patch: this.page(detail.diffContent ?? '', offset, maxChars) } : {})
    };
  }

  static async searchPRFiles(prUrl: string, filters: FileFilters): Promise<{ total: number; files: FileIndexEntryV4[] }> {
    const pr = await this.requireSynced(prUrl);
    const eq = (a: string, b?: string) => !b || a.toLowerCase() === b.toLowerCase();
    const files = OutputReader.getFileIndex(pr.workspace, pr.repoSlug, pr.prId).filter(f =>
      (!filters.path || f.path.toLowerCase().includes(filters.path.toLowerCase())) &&
      eq(f.language, filters.language) &&
      eq(f.status, filters.status) &&
      eq(f.change_kind, filters.change_kind) &&
      (!filters.risk_tag || f.risk_tags.includes(filters.risk_tag))
    );
    return { total: files.length, files: files.slice(0, filters.limit) };
  }

  /**
   * PR comments, fetched live (comments change without new commits), sanitized like PR text.
   * Inline comments are mapped to the local file id when the PR is synced (matched on sanitized path).
   */
  static async getComments(prUrl: string, opts: { offset: number; limit: number; include_resolved: boolean }) {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    const { comments: all, complete } = await this.fetchComments(pr);
    const comments = all.filter(c => opts.include_resolved || !c.resolved);
    const page = comments.slice(opts.offset, opts.offset + opts.limit);
    const end = opts.offset + page.length;
    return { total: comments.length, complete, comments: page, next_offset: end < comments.length ? end : null };
  }

  /**
   * "## Review status (live)" for the context pack: approval counts (never names) and the latest build status per
   * pipeline. Each half fails on its own into "unavailable (…)"; the pack is never lost to it.
   */
  private static async reviewStatusSection(pr: ParsedPRUrl, head?: Head): Promise<string> {
    const lines = ['## Review status (live)'];
    const reason = (err: unknown) => SecretScanner.scanAndRedact(err instanceof Error ? err.message : String(err));
    const collector = new BitbucketCollector();
    try {
      head ??= await collector.getHeadCommits(pr.workspace, pr.repoSlug, pr.prId);
      const ps = head.participants;
      const count = (f: (p: any) => boolean) => ps.filter(f).length;
      lines.push(`Approvals: ${count(p => p.approved)} · Changes requested: ${count(p => p.state === 'changes_requested')} · Participants: ${ps.length} (reviewers: ${count(p => p.role === 'REVIEWER')})`);
    } catch (err) {
      lines.push(`Approvals: unavailable (${reason(err)})`);
    }
    try {
      const res = await collector.getStatuses(pr.workspace, pr.repoSlug, pr.prId);
      // Pagination reports HTTP failures as warnings, not exceptions.
      if (!res.isComplete && res.values.length === 0) throw new Error(res.warnings[0] ?? 'statuses could not be fetched');
      // Re-runs report under the same key: keep only the newest per pipeline.
      const latest = new Map<string, any>();
      for (const s of res.values) {
        const prev = latest.get(s.key);
        if (!prev || String(s.updated_on) > String(prev.updated_on)) latest.set(s.key, s);
      }
      const statuses = [...latest.values()];
      if (statuses.length === 0) {
        lines.push('Build: no status reported');
      } else {
        const n = (state: string) => statuses.filter(s => s.state === state).length;
        lines.push(`Build: ${n('FAILED') + n('STOPPED')} failed, ${n('SUCCESSFUL')} passed, ${n('INPROGRESS')} running`);
        const order = ['FAILED', 'STOPPED', 'INPROGRESS', 'SUCCESSFUL'];
        const clean = (t: unknown) => SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(String(t ?? ''))).replace(/\s+/g, ' ').trim();
        for (const s of statuses.sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state)).slice(0, 5)) {
          const desc = clean(s.description);
          // Metadata carries a 12-char source hash, statuses the full one.
          const stale = head && s.commit?.hash && !String(s.commit.hash).startsWith(head.source) ? ' (older commit)' : '';
          lines.push(`- ${s.state} ${clean(s.name)}${stale}${desc ? `: ${desc.length > 100 ? `${desc.slice(0, 100)}…` : desc}` : ''}`);
        }
      }
    } catch (err) {
      lines.push(`Build: unavailable (${reason(err)})`);
    }
    return lines.join('\n');
  }

  /**
   * "## Review threads (live)" for the context pack: open top-level threads by file id, at most 10 lines.
   * Never throws: a comments outage must not cost the agent the pack.
   */
  private static async reviewThreadsSection(pr: ParsedPRUrl): Promise<string> {
    const title = '## Review threads (live)';
    try {
      const res = await this.fetchComments(pr);
      // Pagination reports HTTP failures as warnings, not exceptions.
      if (!res.complete && res.comments.length === 0) throw new Error(res.warnings[0] ?? 'comments could not be fetched');
      const threads = res.comments.filter(c => c.parent_id === null);
      const open = threads.filter(c => !c.resolved);
      const fromApps = (cs: typeof open) => cs.filter(c => c.author_kind === 'app').length;
      const appNote = (cs: typeof open) => (fromApps(cs) > 0 ? `${fromApps(cs)} from apps` : '');
      const lines = [title, `Open: ${open.length}${appNote(open) ? ` (${appNote(open)})` : ''} · Resolved: ${threads.length - open.length}${res.complete ? '' : ' (incomplete: some comment pages failed)'}`];
      // One line per file (file ids in order), general threads last: bot summaries must not crowd out file threads.
      const byWhere = new Map<string, typeof open>();
      for (const c of open) {
        const where = c.file_id ?? c.path ?? 'general';
        byWhere.set(where, [...(byWhere.get(where) ?? []), c]);
      }
      const groups = [...byWhere].sort(([a], [b]) => (a === 'general' ? 1 : b === 'general' ? -1 : a < b ? -1 : a > b ? 1 : 0));
      const MAX = 10;
      for (const [where, cs] of groups.slice(0, MAX)) {
        const at = [...new Set(cs.map(c => c.line).filter(Boolean))];
        const text = cs[0].text.replace(/\*\*|__|`|#+ /g, '').replace(/\s+/g, ' ').trim();
        const details = [`${cs.length} open`, appNote(cs), at.length > 0 ? `line ${at.join(', ')}` : ''].filter(Boolean).join(', ');
        lines.push(`- ${where} (${details}): ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`);
      }
      if (groups.length > MAX) lines.push(`- … ${groups.length - MAX} more files`);
      if (open.length > 0) lines.push('Full text: get_pr_comments(pr_url, include_resolved=false)');
      return lines.join('\n');
    } catch (err) {
      return `${title}\nUnavailable: ${SecretScanner.scanAndRedact(err instanceof Error ? err.message : String(err))}`;
    }
  }

  /** Every non-deleted comment, sanitized, oldest first; inline ones carry the local file id when the PR is synced. */
  private static async fetchComments(pr: ParsedPRUrl) {
    const res = await new BitbucketCollector().getComments(pr.workspace, pr.repoSlug, pr.prId);
    await AccessGate.unlock(pr.workspace, pr.repoSlug); // to map inline comments onto the encrypted file index
    const { privacy } = ConfigManager.loadBase();

    const idByPath = new Map<string, string>();
    for (const f of OutputReader.getFileIndex(pr.workspace, pr.repoSlug, pr.prId)) if (!idByPath.has(f.path)) idByPath.set(f.path, f.id);

    const clean = (text: string) => SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(text));
    const comments = res.values
      .filter((c: any) => !c.deleted)
      .sort((a: any, b: any) => a.id - b.id)
      .map((c: any) => {
        const inline = c.inline?.path && privacy.file_path_mode !== 'opaque'
          ? { path: PathSanitizer.sanitize(c.inline.path, privacy.file_path_mode), line: c.inline.to ?? c.inline.from ?? null }
          : null;
        return {
          id: c.id,
          parent_id: c.parent?.id ?? null,
          ...(inline ? { file_id: idByPath.get(inline.path) ?? null, path: inline.path, line: inline.line } : {}),
          resolved: Boolean(c.resolution),
          created_on: c.created_on,
          ...(privacy.remove_author ? {} : { author: PIISanitizer.sanitizeAuthor(c.user, false)?.display_name }),
          // Bitbucket's account type, not a name: lets an agent weigh bot output against human review.
          author_kind: (c.user?.type === 'app_user' ? 'app' : 'person') as 'app' | 'person',
          text: clean(c.content?.raw ?? '')
        };
      });
    return { comments, complete: res.isComplete, warnings: res.warnings };
  }

  /** Open PRs authored by the token's account, in one repository or every BITBUCKET_REPOSITORY entry. */
  static async listMyOpenPRs(repository?: string) {
    const collector = new BitbucketCollector(); // credentials + ALLOWED_EMAILS
    const { email, token, repositories } = ConfigManager.credentials();
    const targets = repository ? [repository] : repositories;
    if (targets.length === 0) throw new Error('No repository: pass repository ("workspace/repo") or set BITBUCKET_REPOSITORY in .env.');
    if (targets.some(r => !/^[^/\s]+\/[^/\s]+$/.test(r))) throw new Error('repository must look like "workspace/repo".');

    const me = await collector.currentUserUuid();
    const prs = [];
    for (const target of targets) {
      const [workspace, repoSlug] = target.split('/');
      for (const p of await PRDiscoveryService.discoverOpenPRs(email, token, workspace, repoSlug, me)) {
        prs.push({
          pr_url: `https://bitbucket.org/${workspace}/${repoSlug}/pull-requests/${p.id}`,
          repository: target,
          id: p.id,
          title: p.title,
          is_draft: p.isDraft,
          source_branch: p.sourceBranch,
          target_branch: p.targetBranch,
          updated_on: p.updatedOn,
          local: p.cacheStatus.toLowerCase()
        });
      }
    }
    return { total: prs.length, prs };
  }

  /**
   * Syncs every open PR of the account (one repository or every BITBUCKET_REPOSITORY entry).
   * Unchanged PRs cost one metadata request; one failing PR never stops the batch.
   */
  static async syncMyOpenPRs(repository?: string, force = false) {
    const { prs } = await this.listMyOpenPRs(repository);
    const limit = pLimit(3);
    const results = await Promise.all(prs.map(p => limit(async () => {
      const pr = PRRegistry.parseAndValidateUrl(p.pr_url);
      try {
        const { status } = await this.ensureFresh(pr, force);
        const manifest = OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId)?.manifest;
        return {
          pr_url: p.pr_url, id: p.id, title: p.title, status,
          ticket: manifest?.ticket_id ?? null,
          overall_risk: manifest?.risk_summary.overall_level ?? null,
          files_changed: manifest?.stats.files_changed ?? null,
          updated_on: p.updated_on
        };
      } catch (err) {
        return { pr_url: p.pr_url, id: p.id, title: p.title, status: 'failed' as const, updated_on: p.updated_on,
          error: SecretScanner.scanAndRedact(err instanceof Error ? err.message : String(err)) };
      }
    })));
    const count = (status: string) => results.filter(r => r.status === status).length;
    return { total: results.length, synced: count('synced'), unchanged: count('unchanged'), failed: count('failed'), prs: results };
  }

  /** AUTO_SYNC_ON_START: background sync after the server starts. Never throws; results go to the log. */
  static async autoSync(): Promise<void> {
    try {
      const r = await this.syncMyOpenPRs();
      Logger.info(`auto_sync done total=${r.total} synced=${r.synced} unchanged=${r.unchanged} failed=${r.failed}`);
    } catch (err) {
      Logger.warn(`auto_sync failed type=${err instanceof Error ? err.name : typeof err}`, err instanceof Error ? err.message : String(err));
    }
  }

  static async getSyncStatus(prUrl: string): Promise<object> {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    await AccessGate.unlock(pr.workspace, pr.repoSlug);
    const active = OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId);
    if (!active) return { synced: false };
    const { active_revision, updated_at, source_commit, target_commit, ai_reading_mode } = active.current as any;
    return { synced: true, revision: active_revision, updated_at, source_commit, target_commit, ai_reading_mode, stats: active.manifest?.stats };
  }
}
