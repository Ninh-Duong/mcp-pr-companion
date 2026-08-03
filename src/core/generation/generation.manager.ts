import pLimit from 'p-limit';
import { DiscoveredPR } from '../discovery/pr-list.normalizer.js';
import { GenerationJob } from './generation.job.js';
import { BatchGenerationProgress, PRGenerationJobState } from './generation.types.js';
import { FileLogger } from '../logging/file.logger.js';
import { RunSummaryWriter } from '../logging/run-summary.js';

export class GenerationManager {
  static async executeBatch(
    email: string,
    token: string,
    workspace: string,
    repoSlug: string,
    prs: DiscoveredPR[],
    maxConcurrency = 2,
    forceRefresh = false,
    strategy: 'overwrite' | 'new_version' = 'overwrite',
    onProgress?: (progress: BatchGenerationProgress) => void
  ): Promise<{
    total: number;
    completed: number;
    cached: number;
    failed: number;
    failedPRs: DiscoveredPR[];
    logFilePath: string;
  }> {
    const logger = new FileLogger('generate', workspace, repoSlug);
    const limit = pLimit(maxConcurrency);

    const jobsMap = new Map<number, PRGenerationJobState>();
    prs.forEach((pr) => {
      jobsMap.set(pr.id, {
        prId: pr.id,
        title: pr.title,
        stage: 'queued',
        progressPercent: 0,
        status: 'queued'
      });
    });

    let completedCount = 0;
    let cachedCount = 0;
    let failedCount = 0;
    let activeWorkers = 0;
    const failedPRs: DiscoveredPR[] = [];
    const prResults: Array<{ pr_id: number; status: 'completed' | 'cached' | 'failed'; error_code?: string }> = [];

    const notifyProgress = () => {
      if (onProgress) {
        const total = prs.length;
        const finished = completedCount + cachedCount + failedCount;
        const overallPercent = total > 0 ? Math.round((finished / total) * 100) : 100;

        onProgress({
          totalPRs: total,
          completedCount,
          cachedCount,
          failedCount,
          runningCount: activeWorkers,
          overallPercent,
          activeWorkers,
          maxWorkers: maxConcurrency,
          logFilePath: logger.getLogFilePath(),
          jobs: jobsMap
        });
      }
    };

    logger.log({
      stage: 'batch_generation_started',
      status: 'in_progress',
      total_prs: prs.length
    });

    const tasks = prs.map((pr) =>
      limit(async () => {
        activeWorkers++;
        notifyProgress();

        logger.log({
          stage: 'pr_generation_started',
          status: 'in_progress',
          pr_id: pr.id
        });

        const res = await GenerationJob.executeJob(
          email,
          token,
          workspace,
          repoSlug,
          pr.id,
          pr.title,
          forceRefresh,
          strategy,
          (jobState) => {
            jobsMap.set(pr.id, jobState);
            notifyProgress();
          }
        );

        activeWorkers--;

        if (res.success) {
          if (res.isCached) {
            cachedCount++;
            prResults.push({ pr_id: pr.id, status: 'cached' });
          } else {
            completedCount++;
            prResults.push({ pr_id: pr.id, status: 'completed' });
          }
          logger.log({
            stage: 'pr_generation_completed',
            status: 'success',
            pr_id: pr.id,
            is_cached: res.isCached
          });
        } else {
          failedCount++;
          failedPRs.push(pr);
          prResults.push({ pr_id: pr.id, status: 'failed', error_code: res.errorCode });
          logger.log({
            stage: 'pr_generation_failed',
            status: 'failed',
            pr_id: pr.id,
            error_code: res.errorCode,
            message: res.error
          });
        }

        notifyProgress();
      })
    );

    await Promise.all(tasks);

    logger.log({
      stage: 'batch_generation_completed',
      status: failedCount === 0 ? 'success' : 'failed',
      total_prs: prs.length,
      completed: completedCount,
      cached: cachedCount,
      failed: failedCount
    });

    RunSummaryWriter.writeSummary(workspace, repoSlug, logger.getRunId(), {
      total_prs: prs.length,
      completed: completedCount,
      cached: cachedCount,
      failed: failedCount,
      pr_results: prResults
    });

    return {
      total: prs.length,
      completed: completedCount,
      cached: cachedCount,
      failed: failedCount,
      failedPRs,
      logFilePath: logger.getLogFilePath()
    };
  }
}
