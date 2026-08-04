import { RuntimeSession } from '../auth/runtime-session.js';
import { PRDiscoveryService } from '../discovery/pr-discovery.service.js';
import { PRReadinessFilter, PRViewFilter } from '../discovery/pr-view-filter.js';
import { DiscoveredPR } from '../discovery/pr-list.normalizer.js';
import { GenerationManager } from '../generation/generation.manager.js';
import { BatchGenerationProgress } from '../generation/generation.types.js';

export interface GenerateAllOptions {
  readiness?: PRReadinessFilter;
  forceRefresh?: boolean;
  concurrency?: number;
  strategy?: 'overwrite' | 'new_version';
  onProgress?: (progress: BatchGenerationProgress) => void;
}

export interface GenerateAllResult {
  totalDiscovered: number;
  totalFiltered: number;
  completed: number;
  cached: number;
  failed: number;
  failedPRs: DiscoveredPR[];
  logFilePath: string;
}

export class GenerateAllService {
  static async execute(
    session: RuntimeSession,
    options: GenerateAllOptions = {}
  ): Promise<GenerateAllResult> {
    const readiness = options.readiness || 'all';
    const forceRefresh = options.forceRefresh ?? false;
    const concurrency = options.concurrency ?? 2;
    const strategy = options.strategy || 'overwrite';

    const prs = await PRDiscoveryService.discoverOpenPRs(
      session.email,
      session.token,
      session.repository.workspace,
      session.repository.repoSlug,
      session.currentUserUuid
    );

    const filteredPRs = PRViewFilter.apply(prs, session.currentUserUuid, readiness);

    if (filteredPRs.length === 0) {
      return {
        totalDiscovered: prs.length,
        totalFiltered: 0,
        completed: 0,
        cached: 0,
        failed: 0,
        failedPRs: [],
        logFilePath: ''
      };
    }

    const batchResult = await GenerationManager.executeBatch(
      session.email,
      session.token,
      session.repository.workspace,
      session.repository.repoSlug,
      filteredPRs,
      concurrency,
      forceRefresh,
      strategy,
      options.onProgress
    );

    return {
      totalDiscovered: prs.length,
      totalFiltered: filteredPRs.length,
      completed: batchResult.completed,
      cached: batchResult.cached,
      failed: batchResult.failed,
      failedPRs: batchResult.failedPRs,
      logFilePath: batchResult.logFilePath
    };
  }
}
