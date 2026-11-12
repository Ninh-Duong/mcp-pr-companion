import { randomUUID } from 'crypto';
import { DataStore } from '../core/storage/data.store.js';
import { PRRegistry, ParsedPRUrl } from '../core/registry/pr.registry.js';
import { BitbucketCollector, PRHead } from '../core/bitbucket/bitbucket.collector.js';
import { PRManifestV4 } from '../core/output/schema/manifest.v4.schema.js';
import { OutputReader, ActiveRevisionResult } from '../core/output/output.reader.js';
import { RevisionWriter } from '../core/output/revision.writer.js';
import { DiscoveredPR } from '../core/discovery/pr-list.normalizer.js';
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
import { getPRStorageStatus, PRStorageStatus } from '../core/pr-status.js';
import { LiveReviewSnapshotStore } from '../core/output/live-review-snapshot.store.js';
import { LiveReviewAttemptV1, LiveReviewCommentV1, LiveReviewCompleteSnapshotV1 } from '../core/output/schema/live-review.v1.schema.js';

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
type Head = PRHead;
interface ReviewRefreshResult {
  comments: LiveReviewCommentV1[];
  complete: boolean;
  warnings: string[];
  fallbackSnapshot?: LiveReviewCompleteSnapshotV1;
}
/** Same commit when one hash is a prefix of the other (Bitbucket returns short hashes; revision ids use 7 chars). */
const sameCommit = (a?: string, b?: string) => {
  const x = (a ?? '').toLowerCase();
  const y = (b ?? '').toLowerCase();
  return x.length >= 7 && y.length >= 7 && (x.startsWith(y) || y.startsWith(x));
};
const MAX_COMMENT_CHARS = 4000;
const previewText = (text: string) => text.slice(0, MAX_COMMENT_CHARS);
const statusCommitHash = (status: any): string | null => {
  const href = status?.links?.commit?.href;
  if (typeof href !== 'string') return null;
  try {
    return new URL(href).pathname.match(/\/commit\/([^/]+)(?:\/|$)/)?.[1] ?? null;
  } catch {
    return null;
  }
};

/**
 * MCP-facing reads over the on-disk revision store (the single source of truth: no RAM cache).
 * Every file there is encrypted, so each entry point first calls AccessGate.unlock (one Bitbucket
 * request per repository per minute) before reading or writing.
 */
export class PRContextService {
  private static inFlight = new Map<string, Promise<{ manifest: PRManifestV4; head: Head }>>();

  static page(text: string, offset: number, maxChars: number): Page {
    const end = Math.min(text.length, offset + maxChars);
    return { text: text.slice(offset, end), total_chars: text.length, next_offset: end < text.length ? end : null };
  }

  /**
   * Collects the PR and writes a new revision. Concurrent calls for one PR share one fetch, refresh or not.
   * `metadata` from a freshness check just made is reused instead of fetching it again; the returned head
   * comes from the metadata the revision was built from.
   */
  static sync(pr: ParsedPRUrl, collector = new BitbucketCollector(), metadata?: any): Promise<{ manifest: PRManifestV4; head: Head }> {
    const key = `${pr.workspace}:${pr.repoSlug}:${pr.prId}`;
    let task = this.inFlight.get(key);
    if (!task) {
      task = AccessGate.unlock(pr.workspace, pr.repoSlug)
        .then(() => collector.collect(pr.workspace, pr.repoSlug, pr.prId, {}, metadata))
        .then(async raw => {
          await AccessGate.unlock(pr.workspace, pr.repoSlug); // a long download may outlive the unlock TTL
          const { manifest } = DataStore.saveRevision(pr.workspace, pr.repoSlug, pr.prId, raw);
          return { manifest, head: BitbucketCollector.headOf(raw.metadata) };
        })
        .finally(() => this.inFlight.delete(key));
      this.inFlight.set(key, task);
    }
    return task;
  }

  /**
   * Re-syncs when there is no local revision, on refresh, or when the PR's commits, state, or draft
   * flag changed since the last sync. The note explains a cached answer when freshness could not be checked.
   * Within FRESHNESS_TTL_SECONDS of the last successful check (current.json freshness_checked_at, or the
   * sync itself) no metadata request is made and `recent` carries the age of that check.
   */
  static async ensureFresh(pr: ParsedPRUrl, refresh: boolean): Promise<{
    status: 'synced' | 'unchanged' | 'offline';
    note: string | null;
    head?: Head;
    recent?: { ageSeconds: number; sourceCommit: string };
  }> {
    // Outside the try: missing credentials, ALLOWED_EMAILS denial or no repository access must fail the call.
    const collector = new BitbucketCollector();
    await AccessGate.unlock(pr.workspace, pr.repoSlug);
    const active = refresh ? null : OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId);
    if (!active) {
      const { head } = await this.sync(pr, collector);
      return { status: 'synced', note: null, head };
    }
    const ageMs = this.checkedRecently(pr, active);
    if (ageMs !== null) {
      return { status: 'unchanged', note: null, recent: { ageSeconds: Math.floor(ageMs / 1000), sourceCommit: active.current.source_commit ?? '' } };
    }

    let head: Head;
    try {
      head = await collector.getHeadCommits(pr.workspace, pr.repoSlug, pr.prId);
    } catch (err) {
      const reason = SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(err instanceof Error ? err.message : String(err)));
      return { status: 'offline', note: `Note: could not check Bitbucket for newer commits (${reason}); showing the revision synced at ${active.current.updated_at}.` };
    }
    if (!sameCommit(head.source, active.current.source_commit) ||
      !sameCommit(head.destination, active.current.target_commit) ||
      head.state.toUpperCase() !== active.manifest?.state.toUpperCase() ||
      head.isDraft !== active.manifest?.is_draft ||
      OutputReader.hasPendingStatusMigration(pr.workspace, pr.repoSlug, pr.prId, getPRStorageStatus(head.state, head.isDraft))) {
      const synced = await this.sync(pr, collector, head.metadata);
      return { status: 'synced', note: null, head: synced.head };
    }
    this.recordFreshnessCheck(pr, active);
    return { status: 'unchanged', note: null, head };
  }

  /** Milliseconds since the last successful freshness check when it is within the TTL and nothing is pending; otherwise null. */
  private static checkedRecently(pr: ParsedPRUrl, active: ActiveRevisionResult): number | null {
    const ttlMs = ConfigManager.loadBase().freshness_ttl_seconds * 1000;
    if (ttlMs === 0 || !active.manifest) return null;
    const last = Math.max(Date.parse(active.current.freshness_checked_at ?? '') || 0, Date.parse(active.current.updated_at ?? '') || 0);
    const age = Date.now() - last;
    if (age < 0 || age >= ttlMs) return null; // a clock that moved back never extends the window
    const status = getPRStorageStatus(active.manifest.state, active.manifest.is_draft);
    return OutputReader.hasPendingStatusMigration(pr.workspace, pr.repoSlug, pr.prId, status) ? null : age;
  }

  /** Persists the time of a successful check in current.json. Failing to write it never fails the call. */
  private static recordFreshnessCheck(pr: ParsedPRUrl, active: ActiveRevisionResult): void {
    try {
      RevisionWriter.recordFreshnessCheck(active.prDir, { workspace: pr.workspace, repoSlug: pr.repoSlug, prId: pr.prId }, active.current);
    } catch (err) {
      Logger.warn(`freshness_stamp_failed type=${err instanceof Error ? err.name : typeof err}`);
    }
  }

  static async getContextPack(prUrl: string, refresh: boolean, includeFileTable: boolean): Promise<string> {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    const { note, head, status, recent } = await this.ensureFresh(pr, refresh);
    const context = OutputReader.getContextPack(pr.workspace, pr.repoSlug, pr.prId);
    if (!context) throw new Error('Context pack generation failed: context.md was not written.');

    // Comment refresh is independent of the metadata freshness check and runs once per report.
    const review = await this.refreshReviewSnapshot(pr);
    const live = await Promise.all([
      status === 'offline'
        ? Promise.resolve('## Live review status\nSkipped: Bitbucket could not be reached.')
        : this.reviewStatusSection(pr, head, recent),
      this.reviewThreadsSection(review)
    ]);
    const parts = [note, context, ...live];
    if (includeFileTable) parts.push(OutputReader.getFilesSummary(pr.workspace, pr.repoSlug, pr.prId));
    return parts.filter(Boolean).join('\n\n---\n\n');
  }

  /** Unlocks the PR's repository (live access check) and requires a local revision. */
  private static async requireSynced(prUrl: string): Promise<{ pr: ParsedPRUrl; note: string | null }> {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    const { note } = await this.ensureFresh(pr, false);
    if (!OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId)) throw new Error(NOT_SYNCED);
    return { pr, note };
  }

  static async getFileContext(prUrl: string, fileId: string | number, offset: number, maxChars: number): Promise<Page> {
    const { pr, note } = await this.requireSynced(prUrl);
    const text = OutputReader.getFileContext(pr.workspace, pr.repoSlug, pr.prId, fileId);
    if (!text) throw new Error(`No file ${OutputReader.normalizeFileId(fileId)} in this PR. Use search_pr_files to list file ids.`);
    const page = this.page(text, offset, maxChars);
    return { ...page, text: note ? `${note}\n\n${page.text}` : page.text };
  }

  static async getFileChange(
    prUrl: string,
    fileId: string | number,
    includePatch: boolean,
    offset: number,
    maxChars: number
  ): Promise<{ change: FileChangeV4; patch?: Page }> {
    const { pr, note } = await this.requireSynced(prUrl);
    const detail = OutputReader.getFileChange(pr.workspace, pr.repoSlug, pr.prId, fileId);
    if (!detail) throw new Error(`No file ${OutputReader.normalizeFileId(fileId)} in this PR. Use search_pr_files to list file ids.`);
    const MAX_SYMBOLS = 50;
    const symbols = detail.change.symbols;
    return {
      change: symbols.length > MAX_SYMBOLS ? { ...detail.change, symbols: symbols.slice(0, MAX_SYMBOLS), symbols_total: symbols.length } as FileChangeV4 : detail.change,
      ...(includePatch ? { patch: this.page(detail.diffContent ?? '', offset, maxChars) } : {}),
      ...(note ? { warning: note } : {})
    };
  }

  static async searchPRFiles(prUrl: string, filters: FileFilters): Promise<{ total: number; files: FileIndexEntryV4[] }> {
    const { pr, note } = await this.requireSynced(prUrl);
    const eq = (a: string, b?: string) => !b || a.toLowerCase() === b.toLowerCase();
    const files = OutputReader.getFileIndex(pr.workspace, pr.repoSlug, pr.prId).filter(f =>
      (!filters.path || f.path.toLowerCase().includes(filters.path.toLowerCase())) &&
      eq(f.language, filters.language) &&
      eq(f.status, filters.status) &&
      eq(f.change_kind, filters.change_kind) &&
      (!filters.risk_tag || f.risk_tags.includes(filters.risk_tag))
    );
    return { total: files.length, files: files.slice(0, filters.limit), ...(note ? { warning: note } : {}) };
  }

  /**
   * PR comments, fetched live (comments change without new commits), sanitized like PR text.
   * Inline comments are mapped to the local file id when the PR is synced (matched on sanitized path).
   */
  static async getComments(prUrl: string, opts: { offset: number; limit: number; include_resolved: boolean }) {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    const { note } = await this.ensureFresh(pr, false);
    const snapshot = this.readLatestReviewSnapshot(pr);
    if (!snapshot) {
      const attempt = this.readLatestReviewAttempt(pr, null);
      if (!attempt || attempt.complete) throw new Error('No complete review snapshot is available. Call get_pr_context_pack for this pr_url first.');
      return {
        snapshot_id: null,
        fetched_at: null,
        source_commit: attempt.source_commit,
        total: 0,
        complete: false,
        warnings: [...attempt.warnings, ...(note ? [note] : [])],
        refresh_attempt: attempt,
        comments: [],
        next_offset: null
      };
    }
    const attempt = this.readLatestReviewAttempt(pr, snapshot.snapshot_id);
    const includeAuthor = !ConfigManager.loadBase().privacy.remove_author;
    const comments = snapshot.comments
      .filter(comment => opts.include_resolved || !comment.resolved)
      .map(comment => ({
        ...comment,
        text: previewText(comment.text),
        text_total_chars: comment.text.length,
        ...(comment.text.length > MAX_COMMENT_CHARS ? { text_next_offset: MAX_COMMENT_CHARS } : {}),
        ...(includeAuthor ? {} : { author: undefined })
      }));
    const page = comments.slice(opts.offset, opts.offset + opts.limit);
    const end = opts.offset + page.length;
    const warnings = [...snapshot.warnings];
    if (attempt && !attempt.complete) {
      const age = Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.fetched_at)) / 1000));
      warnings.push(...attempt.warnings, `Serving retained snapshot from ${snapshot.fetched_at} (age ${age}s, source ${snapshot.source_commit}).`);
    }
    if (note) warnings.push(note);
    return {
      snapshot_id: snapshot.snapshot_id,
      fetched_at: snapshot.fetched_at,
      source_commit: snapshot.source_commit,
      total: comments.length,
      complete: true,
      warnings,
      ...(attempt ? { refresh_attempt: attempt } : {}),
      comments: page,
      next_offset: end < comments.length ? end : null
    };
  }

  /** Reads one full sanitized comment body from the encrypted snapshot as a bounded text page. */
  static async getComment(prUrl: string, commentId: number, offset: number, maxChars: number, snapshotId?: string) {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    const { note } = await this.ensureFresh(pr, false);
    const snapshot = this.readLatestReviewSnapshot(pr);
    if (!snapshot) throw new Error('No complete review snapshot is available. Call get_pr_context_pack for this pr_url first.');
    if (offset > 0 && !snapshotId) throw new Error('snapshot_id is required to continue a comment. Restart get_pr_comment at offset=0, then pass its snapshot_id with each next_offset.');
    if (snapshotId !== undefined && snapshotId !== snapshot.snapshot_id) throw new Error('Review snapshot has changed. Restart get_pr_comment at offset=0, then pass its snapshot_id with each next_offset.');
    const source = snapshot.comments.find(comment => comment.id === commentId);
    if (!source) throw new Error(`No comment ${commentId} in the latest complete review snapshot.`);

    const includeAuthor = !ConfigManager.loadBase().privacy.remove_author;
    const { text, ...metadata } = source;
    const attempt = this.readLatestReviewAttempt(pr, snapshot.snapshot_id);
    const warnings = [...snapshot.warnings];
    if (attempt && !attempt.complete) {
      const age = Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.fetched_at)) / 1000));
      warnings.push(...attempt.warnings, `Serving retained snapshot from ${snapshot.fetched_at} (age ${age}s, source ${snapshot.source_commit}).`);
    }
    if (note) warnings.push(note);

    const page = this.page(text, offset, maxChars);
    return {
      snapshot_id: snapshot.snapshot_id,
      comment: { ...metadata, ...(includeAuthor ? {} : { author: undefined }) },
      text: page.text,
      total_chars: page.total_chars,
      next_offset: page.next_offset,
      warnings
    };
  }

  private static async reviewStatusSection(pr: ParsedPRUrl, head?: Head, recent?: { ageSeconds: number; sourceCommit: string }): Promise<string> {
    const lines = ['## Review status (live)'];
    const reason = (err: unknown) => SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(err instanceof Error ? err.message : String(err)));
    const collector = new BitbucketCollector();
    // Build statuses are compared with this source commit: the live one, or the cached one while it is known current.
    const sourceCommit = head?.source ?? recent?.sourceCommit;
    if (head) {
      const state = SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(head.state)).replace(/\s+/g, ' ').slice(0, 40);
      if (state.toUpperCase() !== 'OPEN' || head.isDraft) lines.push(`State: ${state}${head.isDraft ? ' (draft)' : ''}`);
      const participants = head.participants;
      const count = (predicate: (participant: any) => boolean) => participants.filter(predicate).length;
      lines.push(`Approvals: ${count(p => p.approved)} · Changes requested: ${count(p => p.state === 'changes_requested')} · Participants: ${participants.length} (reviewers: ${count(p => p.role === 'REVIEWER')})`);
    } else {
      // Approvals come from the PR metadata request, which the freshness TTL just skipped; it is not made a second way.
      lines.push(`Approvals: not rechecked (Bitbucket was checked ${recent?.ageSeconds ?? 0}s ago; checked again after ${ConfigManager.loadBase().freshness_ttl_seconds}s)`);
    }
    try {
      const res = await collector.getStatuses(pr.workspace, pr.repoSlug, pr.prId);
      if (!res.isComplete && res.values.length === 0) throw new Error(res.warnings[0] ?? 'statuses could not be fetched');
      const clean = (text: unknown) => SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(String(text ?? ''))).replace(/\s+/g, ' ').trim();
      const isOlderCommit = (status: any) => {
        const commitHash = statusCommitHash(status);
        return Boolean(sourceCommit && sourceCommit !== 'unknown_source' && commitHash && !commitHash.toLowerCase().startsWith(sourceCommit.toLowerCase()));
      };
      const latest = new Map<string, any>();
      for (const [index, status] of res.values.entries()) {
        const key = status.key ?? status.name ?? `keyless-${index}`;
        const previous = latest.get(key);
        const isOlder = isOlderCommit(status);
        const previousIsOlder = previous && isOlderCommit(previous);
        const updated = Date.parse(status.updated_on || '') || 0;
        const previousUpdated = Date.parse(previous?.updated_on || '') || 0;
        if (!previous || (previousIsOlder && !isOlder) || (Boolean(previousIsOlder) === isOlder && updated > previousUpdated)) latest.set(key, status);
      }
      const statuses = [...latest.values()];
      if (statuses.length === 0) {
        lines.push('Build: no status reported');
      } else {
        const currentStatuses = statuses.filter(status => !isOlderCommit(status));
        const olderCount = statuses.length - currentStatuses.length;
        const count = (state: string) => currentStatuses.filter(status => status.state === state).length;
        lines.push(`Build: ${count('FAILED') + count('STOPPED')} failed, ${count('SUCCESSFUL')} passed, ${count('INPROGRESS')} running${olderCount ? `; ${olderCount} older commit${olderCount === 1 ? '' : 's'}` : ''}`);
        if (!res.isComplete) lines.push(`Build data incomplete: showing ${res.values.length} statuses from the first pages.`);
        const order = ['FAILED', 'STOPPED', 'INPROGRESS', 'SUCCESSFUL'];
        const rank = (state: string) => order.indexOf(state) < 0 ? order.length : order.indexOf(state);
        for (const status of statuses.sort((a, b) => rank(a.state) - rank(b.state)).slice(0, 5)) {
          const state = clean(status.state).slice(0, 40);
          const name = clean(status.name).slice(0, 100);
          const description = clean(status.description);
          const stale = isOlderCommit(status) ? ' (older commit)' : '';
          lines.push(`- ${state} ${name}${stale}${description ? `: ${description.length > 100 ? `${description.slice(0, 100)}…` : description}` : ''}`);
        }
      }
    } catch (err) {
      lines.push(`Build: unavailable (${reason(err)})`);
    }
    return lines.join('\n');
  }

  private static reviewThreadsSection(result: ReviewRefreshResult): string {
    const title = '## Review threads (live)';
    const threads = result.comments.filter(comment => comment.parent_id === null);
    const open = threads.filter(comment => !comment.resolved);
    const fromApps = (items: typeof open) => items.filter(comment => comment.author_kind === 'app').length;
    const appNote = (items: typeof open) => fromApps(items) > 0 ? `${fromApps(items)} from apps` : '';
    const incomplete = result.complete ? '' : ' (incomplete: some comment pages failed)';
    const lines = [title, `Open: ${open.length}${appNote(open) ? ` (${appNote(open)})` : ''} · Resolved: ${threads.length - open.length}${incomplete}`];
    if (result.fallbackSnapshot) {
      const age = Math.max(0, Math.floor((Date.now() - Date.parse(result.fallbackSnapshot.fetched_at)) / 1000));
      lines.push(`Refresh warning: ${result.warnings.join(' ')}`);
      lines.push(`Serving the last complete snapshot from ${result.fallbackSnapshot.fetched_at} (age ${age}s, source ${result.fallbackSnapshot.source_commit}).`);
    } else if (result.warnings.length) {
      lines.push(`Refresh warning: ${result.warnings.join(' ')}`);
    }
    const byWhere = new Map<string, typeof open>();
    for (const comment of open) {
      const where = comment.file_id ?? comment.path ?? 'general';
      byWhere.set(where, [...(byWhere.get(where) ?? []), comment]);
    }
    const groups = [...byWhere].sort(([a], [b]) => a === 'general' ? 1 : b === 'general' ? -1 : a.localeCompare(b));
    for (const [where, comments] of groups.slice(0, 10)) {
      const at = [...new Set(comments.map(comment => comment.line).filter(Boolean))];
      const text = comments[0].text.replace(/\*\*|__|`|#+ /g, '').replace(/\s+/g, ' ').trim();
      const detail = [`${comments.length} open`, appNote(comments), at.length ? `line ${at.join(', ')}` : ''].filter(Boolean).join(', ');
      lines.push(`- ${where} (${detail}): ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`);
    }
    if (byWhere.size > 10) lines.push(`- … ${byWhere.size - 10} more files: get_pr_comments(pr_url, include_resolved=false) lists them`);
    return lines.join('\n');
  }

  private static async fetchComments(pr: ParsedPRUrl) {
    await AccessGate.unlock(pr.workspace, pr.repoSlug);
    const res = await new BitbucketCollector().getComments(pr.workspace, pr.repoSlug, pr.prId);
    const { privacy } = ConfigManager.loadBase();

    const idByPath = new Map<string, string>();
    for (const f of OutputReader.getFileIndex(pr.workspace, pr.repoSlug, pr.prId)) if (!idByPath.has(f.path)) idByPath.set(f.path, f.id);

    const clean = (text: string) => SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(text));
    const unique = new Map<number, any>();
    for (const comment of res.values) if (!comment.deleted && Number.isSafeInteger(comment.id)) unique.set(comment.id, comment);
    const comments = [...unique.values()]
      .sort((a: any, b: any) => a.id - b.id)
      .map((c: any): LiveReviewCommentV1 => {
        const inline = c.inline?.path && privacy.file_path_mode !== 'opaque'
          ? { path: PathSanitizer.sanitize(c.inline.path, privacy.file_path_mode), line: c.inline.to ?? c.inline.from ?? null }
          : null;
        const authorName = privacy.remove_author ? undefined : PIISanitizer.sanitizeAuthor(c.user, false)?.display_name;
        return {
          id: c.id,
          parent_id: c.parent?.id ?? null,
          ...(inline ? { file_id: idByPath.get(inline.path) ?? null, path: inline.path, line: inline.line } : {}),
          resolved: Boolean(c.resolution),
          created_on: c.created_on,
          ...(authorName ? { author: clean(authorName) } : {}),
          author_kind: (c.user?.type === 'app_user' ? 'app' : 'person') as 'app' | 'person',
          text: clean(c.content?.raw ?? '')
        };
      });
    const warnings = res.warnings.map((warning: string) => clean(warning).replace(/\s+/g, ' ').slice(0, 500));
    return { comments, complete: res.isComplete, warnings };
  }

  private static readLatestReviewSnapshot(pr: ParsedPRUrl): LiveReviewCompleteSnapshotV1 | undefined {
    const snapshots = OutputReader.getPRDirectories(pr.workspace, pr.repoSlug, pr.prId)
      .map(dir => LiveReviewSnapshotStore.readCurrent(dir))
      .filter((snapshot): snapshot is LiveReviewCompleteSnapshotV1 => Boolean(snapshot));
    return snapshots.sort((a, b) => Date.parse(b.fetched_at) - Date.parse(a.fetched_at))[0];
  }

  private static readLatestReviewAttempt(pr: ParsedPRUrl, snapshotId: string | null): LiveReviewAttemptV1 | undefined {
    return OutputReader.getPRDirectories(pr.workspace, pr.repoSlug, pr.prId)
      .map(dir => LiveReviewSnapshotStore.readLastAttempt(dir))
      .filter((attempt): attempt is LiveReviewAttemptV1 => Boolean(attempt && attempt.retained_snapshot_id === snapshotId))
      .sort((a, b) => Date.parse(b.attempted_at) - Date.parse(a.attempted_at))[0];
  }

  private static async refreshReviewSnapshot(pr: ParsedPRUrl): Promise<ReviewRefreshResult> {
    const active = OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId);
    if (!active) throw new Error(NOT_SYNCED);
    const previous = this.readLatestReviewSnapshot(pr);
    try {
      const fetched = await this.fetchComments(pr);
      if (!fetched.complete) {
        const details = fetched.warnings.length ? fetched.warnings.join(' ') : 'Bitbucket comment pagination was incomplete.';
        const warnings = [`Comment refresh failed: ${details}`.slice(0, 500)];
        LiveReviewSnapshotStore.recordLastAttempt(active.prDir, { workspace: pr.workspace, repoSlug: pr.repoSlug, prId: pr.prId }, {
          schema_version: 1,
          attempted_at: new Date().toISOString(),
          complete: false,
          warnings,
          source_commit: active.current.source_commit ?? 'unknown_source',
          retained_snapshot_id: previous?.snapshot_id ?? null
        });
        if (previous) return { comments: previous.comments, complete: true, warnings, fallbackSnapshot: previous };
        return { comments: fetched.comments, complete: false, warnings };
      }
      const snapshot: LiveReviewCompleteSnapshotV1 = {
        schema_version: 1,
        snapshot_id: randomUUID(),
        fetched_at: new Date().toISOString(),
        source_commit: active.current.source_commit ?? 'unknown_source',
        comment_count: fetched.comments.length,
        complete: true,
        warnings: fetched.warnings,
        comments: fetched.comments
      };
      LiveReviewSnapshotStore.publishComplete(active.prDir, { workspace: pr.workspace, repoSlug: pr.repoSlug, prId: pr.prId }, snapshot);
      LiveReviewSnapshotStore.recordLastAttempt(active.prDir, { workspace: pr.workspace, repoSlug: pr.repoSlug, prId: pr.prId }, {
        schema_version: 1,
        attempted_at: snapshot.fetched_at,
        complete: true,
        warnings: fetched.warnings,
        source_commit: snapshot.source_commit,
        retained_snapshot_id: snapshot.snapshot_id
      });
      return { comments: snapshot.comments, complete: true, warnings: [] };
    } catch (err) {
      const reason = SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(err instanceof Error ? err.message : String(err))).replace(/\s+/g, ' ').slice(0, 500);
      const warnings = [`Comment refresh failed: ${reason}`.slice(0, 500)];
      try {
        LiveReviewSnapshotStore.recordLastAttempt(active.prDir, { workspace: pr.workspace, repoSlug: pr.repoSlug, prId: pr.prId }, {
          schema_version: 1,
          attempted_at: new Date().toISOString(),
          complete: false,
          warnings,
          source_commit: active.current.source_commit ?? 'unknown_source',
          retained_snapshot_id: previous?.snapshot_id ?? null
        });
      } catch {
        // The report still carries this sanitized warning if attempt metadata cannot be persisted.
      }
      if (previous) return { comments: previous.comments, complete: true, warnings, fallbackSnapshot: previous };
      return { comments: [], complete: false, warnings };
    }
  }

  /** Open PRs authored by the token's account, in one repository or every BITBUCKET_REPOSITORY entry. */
  static async listMyOpenPRs(repository?: string) {
    const { found, warnings } = await this.discoverMyOpenPRs(repository);
    const prs = found.map(({ pr_url, repository: target, discovered: p }) => ({
      pr_url,
      repository: target,
      id: p.id,
      title: p.title,
      is_draft: p.isDraft,
      source_branch: p.sourceBranch,
      target_branch: p.targetBranch,
      updated_on: p.updatedOn,
      local: p.cacheStatus.toLowerCase()
    }));
    return { total: prs.length, prs, ...(warnings.length ? { warnings } : {}) };
  }

  /** Live discovery, keeping the commits, state and draft flag that Bitbucket's listing already returned. */
  private static async discoverMyOpenPRs(repository?: string) {
    const collector = new BitbucketCollector(); // credentials + ALLOWED_EMAILS
    const { email, token, repositories } = ConfigManager.credentials();
    const targets = repository ? [repository] : repositories;
    if (targets.length === 0) throw new Error(`No repository: pass repository ("workspace/repo") or set BITBUCKET_REPOSITORY in .env or the Hub's bitbucket block.`);
    if (targets.some(r => !/^[\w.-]+\/[\w.-]+$/.test(r) || r.split('/').some(s => /^\.+$/.test(s)))) throw new Error('repository must look like "workspace/repo".');

    const me = await collector.currentUserUuid();
    const found: Array<{ pr_url: string; repository: string; discovered: DiscoveredPR }> = [];
    const warnings: string[] = [];
    for (const target of targets) {
      const [workspace, repoSlug] = target.split('/');
      const result = await PRDiscoveryService.discoverOpenPRsWithWarnings(email, token, workspace, repoSlug, me);
      warnings.push(...result.warnings);
      for (const discovered of result.prs) {
        found.push({ pr_url: `https://bitbucket.org/${workspace}/${repoSlug}/pull-requests/${discovered.id}`, repository: target, discovered });
      }
    }
    return { found, warnings };
  }

  static async listSyncedPRs(repository?: string, status?: PRStorageStatus, offset = 0, limit = 50) {
    const { repositories } = ConfigManager.credentials();
    const targets = repository ? [repository] : repositories;
    if (targets.length === 0) throw new Error(`No repository: pass repository ("workspace/repo") or set BITBUCKET_REPOSITORY in .env or the Hub's bitbucket block.`);
    if (targets.some(r => !/^[\w.-]+\/[\w.-]+$/.test(r) || r.split('/').some(s => /^\.+$/.test(s)))) throw new Error('repository must look like "workspace/repo".');

    const prs = [];
    for (const target of targets) {
      const [workspace, repoSlug] = target.split('/');
      await AccessGate.unlock(workspace, repoSlug);
      for (const id of OutputReader.listPRIds(workspace, repoSlug)) {
        const active = OutputReader.getActiveRevision(workspace, repoSlug, id);
        if (!active?.manifest) continue;
        const manifest = active.manifest;
        const prStatus = getPRStorageStatus(manifest.state, manifest.is_draft);
        if (status && status !== prStatus) continue;
        prs.push({
          pr_url: `https://bitbucket.org/${workspace}/${repoSlug}/pull-requests/${id}`,
          repository: target,
          id,
          title: manifest.title,
          pr_status: prStatus,
          updated_at: active.current.updated_at ?? manifest.provenance?.generated_at ?? ''
        });
      }
    }
    prs.sort((a, b) => b.updated_at.localeCompare(a.updated_at) || a.repository.localeCompare(b.repository) || b.id - a.id);
    const page = prs.slice(offset, offset + limit);
    const end = offset + page.length;
    return { total: prs.length, prs: page, next_offset: end < prs.length ? end : null };
  }

  /**
   * Syncs every open PR of the account (one repository or every BITBUCKET_REPOSITORY entry).
   * Discovery already returns each PR's commits, state and draft flag, so a PR whose active revision matches
   * them costs no request of its own and a PR that differs is synced directly. One failing PR never stops the batch.
   */
  static async syncMyOpenPRs(repository?: string, force = false) {
    const { found, warnings } = await this.discoverMyOpenPRs(repository);
    const limit = pLimit(3);
    const results = await Promise.all(found.map(({ pr_url, discovered: p }) => limit(async () => {
      const pr = PRRegistry.parseAndValidateUrl(pr_url);
      try {
        let status: 'synced' | 'unchanged' | 'offline';
        if (!force && await this.matchesDiscovery(pr, p)) {
          status = 'unchanged';
        } else if (force || (p.sourceCommitHash && p.destinationCommitHash)) {
          await this.sync(pr);
          status = 'synced';
        } else {
          ({ status } = await this.ensureFresh(pr, false)); // the listing had no commits: check the PR itself
        }
        const manifest = OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId)?.manifest;
        return {
          pr_url, id: p.id, title: p.title, status,
          ticket: manifest?.ticket_id ?? null,
          overall_risk: manifest?.risk_summary.overall_level ?? null,
          files_changed: manifest?.stats.files_changed ?? null,
          updated_on: p.updatedOn
        };
      } catch (err) {
        return { pr_url, id: p.id, title: p.title, status: 'failed' as const, updated_on: p.updatedOn,
          error: SecretScanner.scanAndRedact(err instanceof Error ? err.message : String(err)) };
      }
    })));
    const count = (status: string) => results.filter(r => r.status === status).length;
    return { total: results.length, synced: count('synced'), unchanged: count('unchanged'), failed: count('failed'), prs: results, ...(warnings.length ? { warnings } : {}) };
  }

  /** True when the active revision matches the listing's commits, state and draft flag and sits in its status directory. */
  private static async matchesDiscovery(pr: ParsedPRUrl, p: DiscoveredPR): Promise<boolean> {
    if (p.cacheStatus !== 'Cached') return false;
    await AccessGate.unlock(pr.workspace, pr.repoSlug);
    const active = OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId);
    if (!active?.manifest ||
      !sameCommit(active.current.source_commit, p.sourceCommitHash) ||
      !sameCommit(active.current.target_commit, p.destinationCommitHash) ||
      active.manifest.state.toUpperCase() !== p.state.toUpperCase() ||
      active.manifest.is_draft !== p.isDraft ||
      OutputReader.hasPendingStatusMigration(pr.workspace, pr.repoSlug, pr.prId, getPRStorageStatus(p.state, p.isDraft))) {
      return false;
    }
    this.recordFreshnessCheck(pr, active); // the listing was a successful freshness check
    return true;
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
    const { note } = await this.ensureFresh(pr, false);
    const active = OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId);
    if (!active) return { synced: false, ...(note ? { warning: note } : {}) };
    const { active_revision, updated_at, source_commit, target_commit, ai_reading_mode } = active.current as any;
    return {
      synced: true,
      revision: active_revision,
      updated_at,
      source_commit,
      target_commit,
      ai_reading_mode,
      pr_status: active.manifest ? getPRStorageStatus(active.manifest.state, active.manifest.is_draft) : undefined,
      stats: active.manifest?.stats,
      ...(note ? { warning: note } : {})
    };
  }
}
