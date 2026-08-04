import { BitbucketCollector } from '../bitbucket/bitbucket.collector.js';
import { DataStore } from '../storage/data.store.js';
import { PRGenerationJobState, GenerationStage } from './generation.types.js';
import { CacheDecisionService } from './cache-decision.service.js';

export class GenerationJob {
  static async executeJob(
    email: string,
    token: string,
    workspace: string,
    repoSlug: string,
    prId: number,
    title: string,
    forceRefresh = false,
    strategy: 'overwrite' | 'new_version' = 'overwrite',
    onProgress?: (state: PRGenerationJobState) => void
  ): Promise<{ success: boolean; isCached: boolean; error?: string; errorCode?: string }> {
    const jobState: PRGenerationJobState = {
      prId,
      title,
      stage: 'queued',
      progressPercent: 0,
      status: 'running'
    };

    const updateStage = (stage: GenerationStage, percent: number) => {
      jobState.stage = stage;
      jobState.progressPercent = percent;
      if (onProgress) onProgress(jobState);
    };

    updateStage('revision_check', 5);

    try {
      const collector = new BitbucketCollector(email, token);

      updateStage('metadata', 15);
      updateStage('commits', 30);
      updateStage('diffstat', 45);
      updateStage('diff_download', 60);

      const rawRev = await collector.collect(workspace, repoSlug, prId);

      updateStage('privacy_sanitization', 75);
      updateStage('analysis', 85);
      updateStage('atomic_persistence', 95);

      DataStore.saveRevision(workspace, repoSlug, prId, rawRev);

      jobState.status = 'complete';
      updateStage('complete', 100);
      return { success: true, isCached: false };
    } catch (err: any) {
      jobState.status = 'failed';
      jobState.error = err.message || String(err);
      jobState.errorCode = err.status ? `HTTP_${err.status}` : 'GENERATION_FAILED';
      updateStage('failed', jobState.progressPercent);
      return { success: false, isCached: false, error: jobState.error, errorCode: jobState.errorCode };
    }
  }
}
