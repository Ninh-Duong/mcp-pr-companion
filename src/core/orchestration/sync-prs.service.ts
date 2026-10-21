import { RuntimeSession } from '../auth/runtime-session.js';
import { PRDiscoveryService, BitbucketPRState } from '../discovery/pr-discovery.service.js';
import { PRViewFilter } from '../discovery/pr-view-filter.js';
import { PRSyncMode } from '../pr-status.js';
import { DiscoveredPR } from '../discovery/pr-list.normalizer.js';
import { GenerationManager } from '../generation/generation.manager.js';
import { BatchGenerationProgress } from '../generation/generation.types.js';

export interface SyncPRsOptions {
  forceRefresh?: boolean;
  concurrency?: number;
  onProgress?: (progress: BatchGenerationProgress) => void;
}

export interface SyncPRsResult {
  totalDiscovered: number;
  totalFiltered: number;
  completed: number;
  cached: number;
  failed: number;
  failedPRs: DiscoveredPR[];
  logFilePath: string;
  complete: boolean;
  warnings: string[];
}

export class SyncPRsService {
  static async execute(session: RuntimeSession, mode: PRSyncMode, options: SyncPRsOptions = {}): Promise<SyncPRsResult> {
    const states: BitbucketPRState[] = mode === 'all'
      ? ['OPEN', 'MERGED', 'DECLINED']
      : mode === 'open' || mode === 'draft'
        ? ['OPEN']
        : [mode.toUpperCase() as BitbucketPRState];
    const discovery = await PRDiscoveryService.discoverMyPRs(
      session.email,
      session.token,
      session.repository.workspace,
      session.repository.repoSlug,
      session.currentUserUuid,
      states
    );
    const prs = PRViewFilter.applyForSync(discovery.prs, session.currentUserUuid, mode);
    const defaults = {
      totalDiscovered: discovery.prs.length,
      totalFiltered: prs.length,
      completed: 0,
      cached: 0,
      failed: 0,
      failedPRs: [] as DiscoveredPR[],
      logFilePath: '',
      complete: discovery.complete,
      warnings: discovery.warnings
    };
    if (prs.length === 0) return defaults;

    const batch = await GenerationManager.executeBatch(
      session.email,
      session.token,
      session.repository.workspace,
      session.repository.repoSlug,
      prs,
      options.concurrency ?? 2,
      options.forceRefresh ?? false,
      options.onProgress
    );
    return { ...defaults, completed: batch.completed, cached: batch.cached, failed: batch.failed, failedPRs: batch.failedPRs, logFilePath: batch.logFilePath };
  }
}
