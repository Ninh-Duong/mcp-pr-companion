import { BitbucketClient, BitbucketFetchOptions } from './bitbucket.client.js';
import { RawPRRevision } from './bitbucket.types.js';
import { ConfigManager } from '../../config/config.manager.js';
import { AccountPolicy } from '../auth/account-policy.js';
import { Logger } from '../../utils/logger.js';
import { SecretScanner } from '../privacy/secret.scanner.js';

export class BitbucketCollector {
  private client: BitbucketClient;

  /**
   * Without explicit credentials (MCP server path), use BITBUCKET_EMAIL / BITBUCKET_API_TOKEN from .env
   * and enforce ALLOWED_EMAILS here (the CLI enforces it at login).
   */
  constructor(email?: string, token?: string) {
    if (!email || !token) {
      const creds = ConfigManager.credentials();
      email = email || creds.email;
      token = token || creds.token;
      if (!AccountPolicy.isEmailAllowed(email)) {
        throw new Error('Access denied. BITBUCKET_EMAIL is not listed in ALLOWED_EMAILS (.env).');
      }
    }
    if (!token) {
      throw new Error('No Bitbucket credentials: set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN in .env.');
    }
    this.client = new BitbucketClient(email, token);
  }

  /** Throws unless the configured token authenticates (GET /user, read:user scope). The account is for internal use; tools never return it. */
  async checkConnection(): Promise<{ uuid: string }> {
    try {
      return await this.client.getCurrentUser();
    } catch (err: any) {
      if (err.status === 401) throw new Error('Bitbucket rejected the credentials (HTTP 401): check BITBUCKET_EMAIL / BITBUCKET_API_TOKEN in .env.');
      if (err.status === 403) throw new Error('Bitbucket token lacks the read:user scope (HTTP 403).');
      throw new Error(`Bitbucket is unreachable: ${SecretScanner.scanAndRedact(err.message || String(err))}`);
    }
  }

  /** UUID of the account behind the configured token (for "my PRs" discovery). */
  async currentUserUuid(): Promise<string> {
    return (await this.checkConnection()).uuid;
  }

  /** The repository UUID (ai-context key material). Errors are phrased as "No access" and never include the UUID. */
  async getRepositoryUuid(workspace: string, repoSlug: string): Promise<string> {
    try {
      return String((await this.client.getRepository(workspace, repoSlug)).uuid || '');
    } catch (err: any) {
      if (err.status === 401) throw new Error('No access: Bitbucket rejected the credentials (HTTP 401): check BITBUCKET_EMAIL / BITBUCKET_API_TOKEN in .env.');
      if (err.status === 403 || err.status === 404) throw new Error(`No access: this account cannot read ${workspace}/${repoSlug} (HTTP ${err.status}).`);
      throw new Error(`No access: cannot connect to Bitbucket (${SecretScanner.scanAndRedact(err.message || String(err))}).`);
    }
  }

  getComments(workspace: string, repoSlug: string, prId: number) {
    return this.client.getPRComments(workspace, repoSlug, prId);
  }

  getStatuses(workspace: string, repoSlug: string, prId: number) {
    return this.client.getPRStatuses(workspace, repoSlug, prId);
  }

  /**
   * One metadata request: the PR's current source and target commit hashes (used to detect stale revisions),
   * plus its raw participants (approvals) so callers need no second request.
   */
  async getHeadCommits(workspace: string, repoSlug: string, prId: number): Promise<{ source: string; destination: string; participants: any[] }> {
    const metadata = await this.client.getPRMetadata(workspace, repoSlug, prId);
    return {
      source: metadata.source?.commit?.hash || 'unknown_source',
      destination: metadata.destination?.commit?.hash || 'unknown_dest',
      participants: Array.isArray(metadata.participants) ? metadata.participants : []
    };
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
      const errMsg = `Failed to fetch PR metadata: ${SecretScanner.scanAndRedact(err.message || String(err))}`;
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
        warnings.push(`${label} fetch failed: ${SecretScanner.scanAndRedact(err.message || String(err))}`);
        return { values: [] as any[], coverage: 'failed' as const };
      }
    };

    const [commitsRes, diffstatRes, diffRes] = await Promise.all([
      fetchPaged('Commits', () => this.client.getPRCommits(workspace, repoSlug, prId, options)),
      fetchPaged('Diffstat', () => this.client.getPRDiffstat(workspace, repoSlug, prId, options)),
      this.client.getPRDiffText(workspace, repoSlug, prId, options).then(
        text => ({ text, coverage: 'complete' as 'complete' | 'failed' }),
        (err: any) => {
          warnings.push(`Diff download failed: ${SecretScanner.scanAndRedact(err.message || String(err))}`);
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
