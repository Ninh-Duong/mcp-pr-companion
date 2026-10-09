import { BitbucketClient, BitbucketFetchOptions } from './bitbucket.client.js';
import { RawPRRevision } from './bitbucket.types.js';
import { ConfigManager } from '../../config/config.manager.js';
import { Logger } from '../../utils/logger.js';
import { Redactor } from '../../utils/redactor.js';

export class BitbucketCollector {
  private client: BitbucketClient;

  constructor(email?: string, token?: string) {
    if (!email || !token) {
      const resolved = ConfigManager.resolve('read');
      this.client = new BitbucketClient(email || resolved.email, token || resolved.token);
    } else {
      this.client = new BitbucketClient(email, token);
    }
  }

  async collect(workspace: string, repoSlug: string, prId: number, options: BitbucketFetchOptions = {}): Promise<RawPRRevision> {
    const warnings: string[] = [];

    // 1. Fetch Metadata
    let metadata: any = null;
    let metadataCoverage: 'complete' | 'failed' = 'failed';
    try {
      metadata = await this.client.getPRMetadata(workspace, repoSlug, prId, options);
      metadataCoverage = 'complete';
    } catch (err: any) {
      const errMsg = `Failed to fetch PR metadata: ${Redactor.redact(err.message || String(err))}`;
      Logger.error(errMsg);
      throw new Error(errMsg);
    }

    const sourceHash = metadata.source?.commit?.hash || 'unknown_source';
    const destinationHash = metadata.destination?.commit?.hash || 'unknown_dest';

    // 2-4. Commits, diffstat and raw diff are independent: fetch in parallel.
    const fetchPaged = async (label: string, fn: () => Promise<{ values: any[]; isComplete: boolean; warnings: string[] }>) => {
      try {
        const res = await fn();
        warnings.push(...res.warnings);
        return { values: res.values, coverage: (res.isComplete ? 'complete' : 'partial') as 'complete' | 'partial' | 'failed' };
      } catch (err: any) {
        warnings.push(`${label} fetch failed: ${Redactor.redact(err.message || String(err))}`);
        return { values: [] as any[], coverage: 'failed' as const };
      }
    };

    const [commitsRes, diffstatRes, diffRes] = await Promise.all([
      fetchPaged('Commits', () => this.client.getPRCommits(workspace, repoSlug, prId, options)),
      fetchPaged('Diffstat', () => this.client.getPRDiffstat(workspace, repoSlug, prId, options)),
      this.client.getPRDiffText(workspace, repoSlug, prId, options).then(
        text => ({ text, coverage: 'complete' as 'complete' | 'failed' }),
        (err: any) => {
          warnings.push(`Diff download failed: ${Redactor.redact(err.message || String(err))}`);
          return { text: '', coverage: 'failed' as const };
        }
      )
    ]);

    const commits = commitsRes.values;
    const diffstat = diffstatRes.values;
    const rawDiff = diffRes.text;
    const commitsCoverage = commitsRes.coverage;
    const diffstatCoverage = diffstatRes.coverage;
    const diffCoverage = diffRes.coverage;

    return {
      metadata,
      commits,
      diffstat,
      rawDiff,
      sourceHash,
      destinationHash,
      coverage: {
        metadata: metadataCoverage,
        commits: commitsCoverage,
        diffstat: diffstatCoverage,
        diff: diffCoverage
      },
      warnings
    };
  }
}
