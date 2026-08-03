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

    // 2. Fetch Commits
    let commits: any[] = [];
    let commitsCoverage: 'complete' | 'partial' | 'failed' = 'failed';
    try {
      const res = await this.client.getPRCommits(workspace, repoSlug, prId, options);
      commits = res.values;
      warnings.push(...res.warnings);
      commitsCoverage = res.isComplete ? 'complete' : 'partial';
    } catch (err: any) {
      warnings.push(`Commits fetch failed: ${Redactor.redact(err.message || String(err))}`);
    }

    // 3. Fetch Diffstat
    let diffstat: any[] = [];
    let diffstatCoverage: 'complete' | 'partial' | 'failed' = 'failed';
    try {
      const res = await this.client.getPRDiffstat(workspace, repoSlug, prId, options);
      diffstat = res.values;
      warnings.push(...res.warnings);
      diffstatCoverage = res.isComplete ? 'complete' : 'partial';
    } catch (err: any) {
      warnings.push(`Diffstat fetch failed: ${Redactor.redact(err.message || String(err))}`);
    }

    // 4. Fetch Raw Diff
    let rawDiff = '';
    let diffCoverage: 'complete' | 'partial' | 'failed' = 'failed';
    try {
      rawDiff = await this.client.getPRDiffText(workspace, repoSlug, prId, options);
      diffCoverage = 'complete';
    } catch (err: any) {
      warnings.push(`Diff download failed: ${Redactor.redact(err.message || String(err))}`);
    }

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
