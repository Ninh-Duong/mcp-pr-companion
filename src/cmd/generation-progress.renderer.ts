import { BatchGenerationProgress } from '../core/generation/generation.types.js';

export class GenerationProgressRenderer {
  static render(progress: BatchGenerationProgress, overrideLogPath?: string): void {
    console.clear();
    console.log('Generating PR data');
    console.log(`Overall: ${progress.overallPercent}%    Workers: ${progress.activeWorkers}/${progress.maxWorkers}\n`);

    progress.jobs.forEach((job) => {
      let tag = '[WAIT  ]';
      if (job.status === 'cached') tag = '[CACHED]';
      else if (job.status === 'running') tag = '[RUN   ]';
      else if (job.status === 'complete') tag = '[DONE  ]';
      else if (job.status === 'failed') tag = '[ERROR ]';

      const pctStr = job.status === 'failed' ? ' --' : `${String(job.progressPercent).padStart(3, ' ')}%`;
      const stageText = job.status === 'failed' ? (job.error || 'Failed') : job.stage.replace(/_/g, ' ');

      console.log(`${tag} #${job.prId} ${pctStr} ${stageText}`);
    });

    console.log(`\nCompleted: ${progress.completedCount} | Cached: ${progress.cachedCount} | Running: ${progress.runningCount} | Failed: ${progress.failedCount}`);
    console.log(`Log: ${overrideLogPath || progress.logFilePath}\n`);
  }
}
