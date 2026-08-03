import { DataStore } from '../storage/data.store.js';

export interface CacheDecisionResult {
  decision: 'full_generation' | 'reuse_analysis' | 'cache_hit';
  reason: string;
}

export class CacheDecisionService {
  static evaluate(
    workspace: string,
    repoSlug: string,
    prId: number,
    sourceHash?: string,
    destinationHash?: string,
    updatedOn?: string
  ): CacheDecisionResult {
    const active = DataStore.getActiveRevision(workspace, repoSlug, prId);
    if (!active || !active.manifest || !active.current) {
      return { decision: 'full_generation', reason: 'No local cache found' };
    }

    const current = active.current;

    if (sourceHash && destinationHash) {
      if (current.source_hash !== sourceHash || current.destination_hash !== destinationHash) {
        return { decision: 'full_generation', reason: 'Revision commit hashes changed' };
      }
    }

    if (updatedOn) {
      const manifestTime = new Date(active.manifest.generated_at).getTime();
      const prUpdatedTime = new Date(updatedOn).getTime();

      if (prUpdatedTime > manifestTime) {
        return { decision: 'reuse_analysis', reason: 'Metadata updated, code revisions unchanged' };
      }
    }

    return { decision: 'cache_hit', reason: 'Cache is up to date' };
  }
}
