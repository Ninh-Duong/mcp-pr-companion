import { DataStore } from '../storage/data.store.js';
import { DiscoveredPR } from './pr-list.normalizer.js';

export class DiscoveryCache {
  private static prsMap = new Map<number, DiscoveredPR>();

  static setPRs(prs: DiscoveredPR[]): void {
    this.prsMap.clear();
    prs.forEach(pr => this.prsMap.set(pr.id, pr));
  }

  static getPRs(): DiscoveredPR[] {
    return Array.from(this.prsMap.values());
  }

  static getPR(prId: number): DiscoveredPR | undefined {
    return this.prsMap.get(prId);
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

    const manifest = active.manifest;

    // Compare commit hashes if available
    if (sourceCommitHash && destinationCommitHash) {
      // Revisions check
      if (
        active.current?.source_hash === sourceCommitHash &&
        active.current?.destination_hash === destinationCommitHash
      ) {
        return 'Cached';
      }
    }

    // Check manifest timestamp vs updatedOn
    const manifestTime = new Date(manifest.generated_at).getTime();
    const prUpdatedTime = new Date(updatedOn).getTime();

    if (manifestTime >= prUpdatedTime) {
      return 'Cached';
    }

    return 'Outdated';
  }

  static clear(): void {
    this.prsMap.clear();
  }
}
