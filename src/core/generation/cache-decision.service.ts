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
    return { decision: 'full_generation', reason: 'Cache disabled - direct export to output/' };
  }
}
