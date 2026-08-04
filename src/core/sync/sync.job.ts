import { PRRegistry } from '../registry/pr.registry.js';
import { BitbucketCollector } from '../bitbucket/bitbucket.collector.js';
import { DataStore } from '../storage/data.store.js';
import { RetentionService } from '../storage/retention.service.js';
import { RetryPolicy } from './retry.policy.js';
import { SyncOptions, ProgressEvent } from './sync.types.js';
import { Redactor } from '../../utils/redactor.js';

export class SyncJob {
  constructor(
    private runId: string,
    private url: string,
    private options: SyncOptions = {}
  ) {}

  async execute(): Promise<{ status: 'complete' | 'cached'; ticketId?: string; sourceHash?: string }> {
    const emit = (stage: ProgressEvent['stage'], percent: number, message: string, error?: string, ticketId?: string) => {
      if (this.options.onProgress) {
        let workspace = 'unknown';
        let repoSlug = 'unknown';
        let prId = 0;
        try {
          const parsed = PRRegistry.parseAndValidateUrl(this.url);
          workspace = parsed.workspace;
          repoSlug = parsed.repoSlug;
          prId = parsed.prId;
        } catch {
          // Ignore parse failure in progress emitter
        }

        this.options.onProgress({
          runId: this.runId,
          url: this.url,
          workspace,
          repoSlug,
          prId,
          ticketId,
          stage,
          percent,
          message,
          error
        });
      }
    };

    emit('queued', 0, 'Queued');

    // Stage 1: Validate URL (5%)
    emit('validating', 5, 'Validating URL');
    const parsed = PRRegistry.parseAndValidateUrl(this.url);

    // Stage 2: Quick Cache Check before making heavy network calls (15%)
    emit('fetching_metadata', 15, 'Fetching PR metadata');

    const collector = new BitbucketCollector();

    const rawRev = await RetryPolicy.executeWithRetry(async () => {
      return await collector.collect(parsed.workspace, parsed.repoSlug, parsed.prId, {
        signal: this.options.signal
      });
    }, 3, this.options.signal);

    const ticketId = rawRev.metadata?.title
      ? rawRev.metadata.title.match(/([A-Z]+-\d+)/)?.[1]
      : undefined;

    // Fetch commits, diffstat, and analyze diff
    emit('fetching_commits', 30, 'Fetching commit history', undefined, ticketId);
    emit('fetching_diffstat', 45, 'Fetching diffstat', undefined, ticketId);
    emit('downloading_diff', 60, 'Downloading diff', undefined, ticketId);
    emit('analyzing', 75, 'Analyzing changed files', undefined, ticketId);

    // Persist data & export to output/
    emit('persisting', 95, 'Persisting cache & exporting raw data to output/', undefined, ticketId);
    DataStore.saveRevision(parsed.workspace, parsed.repoSlug, parsed.prId, rawRev);

    // Retention Cleanup
    RetentionService.cleanOldRevisions(parsed.workspace, parsed.repoSlug, parsed.prId);

    emit('complete', 100, 'Complete (cache updated)', undefined, ticketId);
    return { status: 'complete', ticketId, sourceHash: rawRev.sourceHash };
  }
}
