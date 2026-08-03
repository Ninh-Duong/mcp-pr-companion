import { DataStore } from '../core/storage/data.store.js';
import { PRRegistry } from '../core/registry/pr.registry.js';
import { BitbucketCollector } from '../core/bitbucket/bitbucket.collector.js';
import { PRManifestV3 } from '../core/privacy/manifest.v3.schema.js';
import { PRFileDetailV3 } from '../core/privacy/file_detail.v3.schema.js';

export class PRContextService {
  private static manifestCache = new Map<string, { manifest: PRManifestV3; timestamp: number }>();
  private static fileDetailCache = new Map<string, { detail: PRFileDetailV3; timestamp: number }>();

  private static maxCacheEntries = 20;

  static async getManifest(prUrl: string, refresh = false): Promise<PRManifestV3> {
    const parsed = PRRegistry.parseAndValidateUrl(prUrl);
    const prDirKey = `${parsed.workspace}:${parsed.repoSlug}:${parsed.prId}`;

    // 1. Check RAM Cache unless refresh is requested
    if (!refresh && this.manifestCache.has(prDirKey)) {
      return this.manifestCache.get(prDirKey)!.manifest;
    }

    // 2. Check Local Disk DataStore unless refresh is requested
    if (!refresh) {
      const active = DataStore.getActiveRevision(parsed.workspace, parsed.repoSlug, parsed.prId);
      if (active && active.manifest) {
        this.setManifestCache(prDirKey, active.manifest);
        return active.manifest;
      }
    }

    // 3. Collect from Bitbucket API if not in cache/disk or if refresh is true
    const collector = new BitbucketCollector();
    const rawRev = await collector.collect(parsed.workspace, parsed.repoSlug, parsed.prId);
    const result = DataStore.saveRevision(parsed.workspace, parsed.repoSlug, parsed.prId, rawRev);

    this.setManifestCache(prDirKey, result.manifest);
    return result.manifest;
  }

  static async getFileDetail(prUrl: string, fileId: string | number): Promise<PRFileDetailV3 | null> {
    const parsed = PRRegistry.parseAndValidateUrl(prUrl);
    const detailKey = `${parsed.workspace}:${parsed.repoSlug}:${parsed.prId}:${fileId}`;

    if (this.fileDetailCache.has(detailKey)) {
      return this.fileDetailCache.get(detailKey)!.detail;
    }

    const detail = DataStore.getFileDetail(parsed.workspace, parsed.repoSlug, parsed.prId, fileId);
    if (detail) {
      this.setFileDetailCache(detailKey, detail);
    }
    return detail;
  }

  static getSyncStatus(prUrl: string): { synced: boolean; current?: any; manifestStats?: any } {
    try {
      const parsed = PRRegistry.parseAndValidateUrl(prUrl);
      const active = DataStore.getActiveRevision(parsed.workspace, parsed.repoSlug, parsed.prId);

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

  static async refreshPRData(prUrl: string): Promise<PRManifestV3> {
    return this.getManifest(prUrl, true);
  }

  private static setManifestCache(key: string, manifest: PRManifestV3): void {
    if (this.manifestCache.size >= this.maxCacheEntries) {
      const firstKey = this.manifestCache.keys().next().value;
      if (firstKey) this.manifestCache.delete(firstKey);
    }
    this.manifestCache.set(key, { manifest, timestamp: Date.now() });
  }

  private static setFileDetailCache(key: string, detail: PRFileDetailV3): void {
    if (this.fileDetailCache.size >= (this.maxCacheEntries * 10)) {
      const firstKey = this.fileDetailCache.keys().next().value;
      if (firstKey) this.fileDetailCache.delete(firstKey);
    }
    this.fileDetailCache.set(key, { detail, timestamp: Date.now() });
  }
}
