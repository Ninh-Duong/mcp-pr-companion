import { DataStore } from '../core/storage/data.store.js';
import { PRRegistry } from '../core/registry/pr.registry.js';
import { BitbucketCollector } from '../core/bitbucket/bitbucket.collector.js';
import { PRManifestV4 } from '../core/output/schema/manifest.v4.schema.js';
import { FileChangeV4 } from '../core/output/schema/file_change.v4.schema.js';
import { OutputReader } from '../core/output/output.reader.js';
import { ConfigManager } from '../config/config.manager.js';
import { FileIndexEntryV4 } from '../core/output/schema/file_index.v4.schema.js';

export class PRContextService {
  private static manifestCache = new Map<string, { manifest: PRManifestV4; revisionId: string; timestamp: number }>();
  private static fileChangeCache = new Map<string, { change: FileChangeV4; diffContent?: string; timestamp: number }>();
  private static inFlightRequests = new Map<string, Promise<PRManifestV4>>();

  private static getTTL(): number {
    const config = ConfigManager.loadBase();
    const ttlMinutes = (config.privacy as any)?.cache_ttl_minutes || (config.cache as any)?.retention_days * 24 * 60 || 60;
    return ttlMinutes * 60 * 1000;
  }

  private static getMaxEntries(): number {
    const config = ConfigManager.loadBase();
    return (config.privacy as any)?.max_ram_cache_entries || (config.cache as any)?.max_revisions_per_pr * 10 || 20;
  }

  static async getManifest(prUrl: string, refresh = false): Promise<PRManifestV4> {
    const parsed = PRRegistry.parseAndValidateUrl(prUrl);
    const prKey = `${parsed.workspace}:${parsed.repoSlug}:${parsed.prId}`;

    // 1. Check in-flight request deduplication
    if (!refresh && this.inFlightRequests.has(prKey)) {
      return await this.inFlightRequests.get(prKey)!;
    }

    const fetchTask = (async (): Promise<PRManifestV4> => {
      const now = Date.now();
      const ttl = this.getTTL();

      // 2. Check RAM Cache unless refresh is requested
      if (!refresh && this.manifestCache.has(prKey)) {
        const cached = this.manifestCache.get(prKey)!;
        if (now - cached.timestamp < ttl) {
          return cached.manifest;
        }
        this.manifestCache.delete(prKey);
      }

      // 3. Check Local Disk Output DataStore unless refresh is requested
      if (!refresh) {
        const active = DataStore.getActiveRevision(parsed.workspace, parsed.repoSlug, parsed.prId);
        if (active && active.manifest) {
          this.setManifestCache(prKey, active.manifest, active.current.active_revision);
          return active.manifest;
        }
      }

      // 4. Collect from Bitbucket API if not in cache/disk or if refresh is true
      const collector = new BitbucketCollector();
      const rawRev = await collector.collect(parsed.workspace, parsed.repoSlug, parsed.prId);
      const result = DataStore.saveRevision(parsed.workspace, parsed.repoSlug, parsed.prId, rawRev);

      this.setManifestCache(prKey, result.manifest, result.revisionId);
      return result.manifest;
    })();

    this.inFlightRequests.set(prKey, fetchTask);
    try {
      const result = await fetchTask;
      return result;
    } finally {
      this.inFlightRequests.delete(prKey);
    }
  }

  static async getFileChange(
    prUrl: string,
    fileId: string | number,
    includePatch = true,
    maxBytes = 16000
  ): Promise<{ change: FileChangeV4; diffContent?: string; truncated?: boolean } | null> {
    const parsed = PRRegistry.parseAndValidateUrl(prUrl);

    // Coerce numeric input to string ID format (e.g. 1 -> "file_0001")
    let normalizedId = typeof fileId === 'number' ? `file_${String(fileId).padStart(4, '0')}` : String(fileId);
    if (/^\d+$/.test(normalizedId)) {
      normalizedId = `file_${String(parseInt(normalizedId, 10)).padStart(4, '0')}`;
    }

    const detailKey = `${parsed.workspace}:${parsed.repoSlug}:${parsed.prId}:${normalizedId}`;
    const ttl = this.getTTL();
    const now = Date.now();

    let record = this.fileChangeCache.get(detailKey);
    if (!record || now - record.timestamp >= ttl) {
      const loaded = DataStore.getFileDetail(parsed.workspace, parsed.repoSlug, parsed.prId, normalizedId);
      if (!loaded) return null;

      record = { change: loaded.change, diffContent: loaded.diffContent, timestamp: now };
      this.setFileChangeCache(detailKey, record);
    }

    let diffContent = includePatch ? record.diffContent : undefined;
    let truncated = false;

    if (diffContent && diffContent.length > maxBytes) {
      diffContent = diffContent.substring(0, maxBytes) + '\n... [Diff truncated due to size limit]';
      truncated = true;
    }

    return {
      change: record.change,
      diffContent,
      truncated
    };
  }

  static searchPRFiles(
    prUrl: string,
    filters?: {
      path?: string;
      language?: string;
      status?: string;
      change_kind?: string;
      risk_tag?: string;
      limit?: number;
    }
  ): { total: number; files: FileIndexEntryV4[] } {
    const parsed = PRRegistry.parseAndValidateUrl(prUrl);
    let files = OutputReader.getFileIndex(parsed.workspace, parsed.repoSlug, parsed.prId);

    if (filters) {
      if (filters.path) {
        const query = filters.path.toLowerCase();
        files = files.filter(f => f.path.toLowerCase().includes(query));
      }
      if (filters.language) {
        files = files.filter(f => f.language.toLowerCase() === filters.language!.toLowerCase());
      }
      if (filters.status) {
        files = files.filter(f => f.status.toLowerCase() === filters.status!.toLowerCase());
      }
      if (filters.change_kind) {
        files = files.filter(f => f.change_kind.toLowerCase() === filters.change_kind!.toLowerCase());
      }
      if (filters.risk_tag) {
        files = files.filter(f => f.risk_tags.includes(filters.risk_tag!));
      }
    }

    const limit = filters?.limit || 50;
    return {
      total: files.length,
      files: files.slice(0, limit)
    };
  }

  static getSyncStatus(prUrl: string): { synced: boolean; current?: any; manifestStats?: any } {
    try {
      const parsed = PRRegistry.parseAndValidateUrl(prUrl);
      const active = OutputReader.getActiveRevision(parsed.workspace, parsed.repoSlug, parsed.prId);

      if (active) {
        return {
          synced: true,
          current: active.current,
          manifestStats: active.manifest?.stats
        };
      }
    } catch {
      // Ignore
    }

    return { synced: false };
  }

  static async refreshPRData(prUrl: string): Promise<PRManifestV4> {
    return this.getManifest(prUrl, true);
  }

  private static setManifestCache(key: string, manifest: PRManifestV4, revisionId: string): void {
    const maxEntries = this.getMaxEntries();
    if (this.manifestCache.size >= maxEntries) {
      const firstKey = this.manifestCache.keys().next().value;
      if (firstKey) this.manifestCache.delete(firstKey);
    }
    this.manifestCache.set(key, { manifest, revisionId, timestamp: Date.now() });
  }

  private static setFileChangeCache(key: string, record: { change: FileChangeV4; diffContent?: string; timestamp: number }): void {
    const maxEntries = this.getMaxEntries() * 20;
    if (this.fileChangeCache.size >= maxEntries) {
      const firstKey = this.fileChangeCache.keys().next().value;
      if (firstKey) this.fileChangeCache.delete(firstKey);
    }
    this.fileChangeCache.set(key, record);
  }
}
