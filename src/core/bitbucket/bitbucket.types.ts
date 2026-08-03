export interface RawPRRevision {
  metadata: any;
  commits: any[];
  diffstat: any[];
  rawDiff: string;
  sourceHash: string;
  destinationHash: string;
  coverage: {
    metadata: 'complete' | 'failed';
    commits: 'complete' | 'partial' | 'failed';
    diffstat: 'complete' | 'partial' | 'failed';
    diff: 'complete' | 'partial' | 'failed';
  };
  warnings: string[];
}

export interface BitbucketClientConfig {
  email?: string;
  token?: string;
  timeoutMs?: number;
}
