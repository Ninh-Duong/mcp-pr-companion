import { DataStore } from '../storage/data.store.js';
import { DiscoveredPR } from './pr-list.normalizer.js';
import { normalizeUuid } from '../auth/current-user.resolver.js';

export class DiscoveryCache {
  private static scopedMap = new Map<string, Map<number, DiscoveredPR>>();

  static getScopeKey(userUuid: string, workspace: string, repoSlug: string): string {
    const normUuid = normalizeUuid(userUuid);
    const normWs = workspace.trim().toLowerCase();
    const normRepo = repoSlug.trim().toLowerCase();
    return `${normUuid}:${normWs}:${normRepo}`;
  }

  static setPRs(userUuid: string, workspace: string, repoSlug: string, prs: DiscoveredPR[]): void {
    const key = this.getScopeKey(userUuid, workspace, repoSlug);
    const prMap = new Map<number, DiscoveredPR>();
    prs.forEach(pr => prMap.set(pr.id, pr));
    this.scopedMap.set(key, prMap);
  }

  static getPRs(userUuid: string, workspace: string, repoSlug: string): DiscoveredPR[] {
    const key = this.getScopeKey(userUuid, workspace, repoSlug);
    const prMap = this.scopedMap.get(key);
    return prMap ? Array.from(prMap.values()) : [];
  }

  static getPR(userUuid: string, workspace: string, repoSlug: string, prId: number): DiscoveredPR | undefined {
    const key = this.getScopeKey(userUuid, workspace, repoSlug);
    const prMap = this.scopedMap.get(key);
    return prMap ? prMap.get(prId) : undefined;
  }

  static evaluateCacheStatus(
    workspace: string,
    repoSlug: string,
    prId: number,
    updatedOn: string,
    sourceCommitHash?: string,
    destinationCommitHash?: string
  ): 'Missing' | 'Cached' | 'Outdated' {
    const active = DataStore.getActiveRevision(workspace, repoSlug, prId);
    if (!active || !active.manifest) {
      return 'Missing';
    }

    const current = active.current;

    // Compare commit hashes if available
    if (sourceCommitHash && destinationCommitHash) {
      const srcMatch = current?.source_commit === sourceCommitHash || current?.source_hash === sourceCommitHash;
      const dstMatch = current?.target_commit === destinationCommitHash || current?.destination_hash === destinationCommitHash;
      if (srcMatch && dstMatch) {
        return 'Cached';
      }
    }

    // Check current generated_at timestamp vs updatedOn
    const generatedTime = current?.generated_at ? new Date(current.generated_at).getTime() : 0;
    const prUpdatedTime = new Date(updatedOn).getTime();

    if (generatedTime >= prUpdatedTime) {
      return 'Cached';
    }

    return 'Outdated';
  }

  static clearScope(userUuid: string, workspace: string, repoSlug: string): void {
    const key = this.getScopeKey(userUuid, workspace, repoSlug);
    this.scopedMap.delete(key);
  }

  static clearAll(): void {
    this.scopedMap.clear();
  }

  static clear(): void {
    this.clearAll();
  }
}
