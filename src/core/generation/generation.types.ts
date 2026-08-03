export type GenerationStage =
  | 'queued'
  | 'revision_check'
  | 'metadata'
  | 'commits'
  | 'diffstat'
  | 'diff_download'
  | 'privacy_sanitization'
  | 'analysis'
  | 'atomic_persistence'
  | 'complete'
  | 'failed';

export interface PRGenerationJobState {
  prId: number;
  title: string;
  stage: GenerationStage;
  progressPercent: number;
  status: 'queued' | 'running' | 'cached' | 'complete' | 'failed';
  error?: string;
  errorCode?: string;
}

export interface BatchGenerationProgress {
  totalPRs: number;
  completedCount: number;
  cachedCount: number;
  failedCount: number;
  runningCount: number;
  overallPercent: number;
  activeWorkers: number;
  maxWorkers: number;
  logFilePath: string;
  jobs: Map<number, PRGenerationJobState>;
}
