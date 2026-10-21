import { BitbucketCollector } from '../bitbucket/bitbucket.collector.js';
import { AccessGate } from '../auth/access-gate.js';
import { DataStore } from '../storage/data.store.js';
import { PRGenerationJobState, GenerationStage } from './generation.types.js';
import { OutputReader } from '../output/output.reader.js';
import { getPRStorageStatus } from '../pr-status.js';

export class GenerationJob {
  static async executeJob(
    email: string,
    token: string,
    workspace: string,
    repoSlug: string,
    prId: number,
    title: string,
    forceRefresh = false,
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
      await AccessGate.unlock(workspace, repoSlug); // the local cache is encrypted

      // Unless forced, skip PRs whose stored revision still matches the PR's head commits.
      const active = forceRefresh ? null : DataStore.getActiveRevision(workspace, repoSlug, prId);
      if (active) {
        updateStage('metadata', 15);
        const head = await collector.getHeadCommits(workspace, repoSlug, prId);
        if (head.source === active.current.source_commit &&
          head.destination === active.current.target_commit &&
          head.state.toUpperCase() === active.manifest?.state.toUpperCase() &&
          head.isDraft === active.manifest?.is_draft &&
          !OutputReader.hasPendingStatusMigration(workspace, repoSlug, prId, getPRStorageStatus(head.state, head.isDraft))) {
          jobState.status = 'cached';
          updateStage('complete', 100);
          return { success: true, isCached: true };
        }
      }

      updateStage('diff_download', 30);
      const rawRev = await collector.collect(workspace, repoSlug, prId);

      updateStage('analysis', 80);
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
