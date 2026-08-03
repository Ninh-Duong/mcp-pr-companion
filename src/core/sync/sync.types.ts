export type SyncStage =
  | 'queued'
  | 'validating'
  | 'fetching_metadata'
  | 'fetching_commits'
  | 'fetching_diffstat'
  | 'downloading_diff'
  | 'analyzing'
  | 'persisting'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface ProgressEvent {
  runId: string;
  url: string;
  workspace: string;
  repoSlug: string;
  prId: number;
  ticketId?: string;
  stage: SyncStage;
  percent: number;
  message: string;
  error?: string;
  bytesDownloaded?: number;
  totalBytes?: number;
}

export interface SyncOptions {
  concurrency?: number;
  forceRefresh?: boolean;
  persistRawDiff?: boolean;
  signal?: AbortSignal;
  onProgress?: (event: ProgressEvent) => void;
}

export interface RunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  total: number;
  succeeded: number;
  cached: number;
  failed: number;
  cancelled: number;
  items: Array<{
    url: string;
    status: 'complete' | 'cached' | 'failed' | 'cancelled';
    ticketId?: string;
    sourceHash?: string;
    error?: string;
  }>;
}
