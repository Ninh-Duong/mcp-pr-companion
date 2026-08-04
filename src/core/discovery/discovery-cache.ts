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

  static clear(): void {
    this.prsMap.clear();
  }
}
