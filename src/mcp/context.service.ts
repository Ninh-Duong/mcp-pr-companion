import { DataStore } from '../core/storage/data.store.js';
import { PRRegistry, ParsedPRUrl } from '../core/registry/pr.registry.js';
import { BitbucketCollector } from '../core/bitbucket/bitbucket.collector.js';
import { PRManifestV4 } from '../core/output/schema/manifest.v4.schema.js';
import { OutputReader } from '../core/output/output.reader.js';
import { FileIndexEntryV4 } from '../core/output/schema/file_index.v4.schema.js';
import { FileChangeV4 } from '../core/output/schema/file_change.v4.schema.js';
import { SecretScanner } from '../core/privacy/secret.scanner.js';

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

  static getSyncStatus(prUrl: string): object {
    const pr = PRRegistry.parseAndValidateUrl(prUrl);
    const active = OutputReader.getActiveRevision(pr.workspace, pr.repoSlug, pr.prId);
    if (!active) return { synced: false };
    const { active_revision, updated_at, source_commit, target_commit, ai_reading_mode } = active.current as any;
    return { synced: true, revision: active_revision, updated_at, source_commit, target_commit, ai_reading_mode, stats: active.manifest?.stats };
  }
}
