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

const NOT_SYNCED = 'PR is not synced yet. Call get_pr_context_pack for this pr_url first.';

/**
 * MCP-facing reads over the on-disk revision store (the single source of truth: no RAM cache).
 * Only getContextPack talks to Bitbucket; every other method reads local files.
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
      task = collector
        .collect(pr.workspace, pr.repoSlug, pr.prId)
        .then(raw => DataStore.saveRevision(pr.workspace, pr.repoSlug, pr.prId, raw).manifest)
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, task);
    }
    return task;
  }

  /**
   * Re-syncs when there is no local revision, on refresh, or when the PR's source/target commits
   * moved since the last sync. Returns a note when freshness could not be checked (offline).
   */
  static async ensureFresh(pr: ParsedPRUrl, refresh: boolean): Promise<string | null> {
    // Built outside the try: missing credentials or ALLOWED_EMAILS denial must fail the call.
    const collector = new BitbucketCollector();
    const active = OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId);
    if (refresh || !active) {
      await this.sync(pr, collector);
      return null;
    }

    let head: { source: string; destination: string };
    try {
      head = await collector.getHeadCommits(pr.workspace, pr.repoSlug, pr.prId);
    } catch (err) {
      const reason = SecretScanner.scanAndRedact(err instanceof Error ? err.message : String(err));
      return `Note: could not check Bitbucket for newer commits (${reason}); showing the revision synced at ${active.current.updated_at}.`;
    }
    if (head.source !== active.current.source_commit || head.destination !== active.current.target_commit) {
      await this.sync(pr, collector);
    }
    return null;
  }

  static async getContextPack(prUrl: string, refresh: boolean, includeFileTable: boolean): Promise<string> {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    const note = await this.ensureFresh(pr, refresh);
    const context = OutputReader.getContextPack(pr.workspace, pr.repoSlug, pr.prId);
    if (!context) throw new Error('Context pack generation failed: context.md was not written.');

    const parts = [note, context];
    if (includeFileTable) parts.push(OutputReader.getFilesSummary(pr.workspace, pr.repoSlug, pr.prId));
    return parts.filter(Boolean).join('\n\n---\n\n');
  }

  private static requireSynced(prUrl: string): ParsedPRUrl {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    if (!OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId)) throw new Error(NOT_SYNCED);
    return pr;
  }

  static getFileContext(prUrl: string, fileId: string | number, offset: number, maxChars: number): Page {
    const pr = this.requireSynced(prUrl);
    const text = OutputReader.getFileContext(pr.workspace, pr.repoSlug, pr.prId, fileId);
    if (!text) throw new Error(`No file ${OutputReader.normalizeFileId(fileId)} in this PR. Use search_pr_files to list file ids.`);
    return this.page(text, offset, maxChars);
  }

  static getFileChange(
    prUrl: string,
    fileId: string | number,
    includePatch: boolean,
    offset: number,
    maxChars: number
  ): { change: FileChangeV4; patch?: Page } {
    const pr = this.requireSynced(prUrl);
    const detail = OutputReader.getFileChange(pr.workspace, pr.repoSlug, pr.prId, fileId);
    if (!detail) throw new Error(`No file ${OutputReader.normalizeFileId(fileId)} in this PR. Use search_pr_files to list file ids.`);
    return {
      change: detail.change,
      ...(includePatch ? { patch: this.page(detail.diffContent ?? '', offset, maxChars) } : {})
    };
  }

  static searchPRFiles(prUrl: string, filters: FileFilters): { total: number; files: FileIndexEntryV4[] } {
    const pr = this.requireSynced(prUrl);
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
    const res = await new BitbucketCollector().getComments(pr.workspace, pr.repoSlug, pr.prId);
    const { privacy } = ConfigManager.loadBase();

    const idByPath = new Map<string, string>();
    for (const f of OutputReader.getFileIndex(pr.workspace, pr.repoSlug, pr.prId)) if (!idByPath.has(f.path)) idByPath.set(f.path, f.id);

    const clean = (text: string) => SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(text));
    const comments = res.values
      .filter((c: any) => !c.deleted && (opts.include_resolved || !c.resolution))
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
          text: clean(c.content?.raw ?? '')
        };
      });

    const page = comments.slice(opts.offset, opts.offset + opts.limit);
    const end = opts.offset + page.length;
    return { total: comments.length, complete: res.isComplete, comments: page, next_offset: end < comments.length ? end : null };
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

  static getSyncStatus(prUrl: string): object {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    const active = OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId);
    if (!active) return { synced: false };
    const { active_revision, updated_at, source_commit, target_commit, ai_reading_mode } = active.current as any;
    return { synced: true, revision: active_revision, updated_at, source_commit, target_commit, ai_reading_mode, stats: active.manifest?.stats };
  }
}
