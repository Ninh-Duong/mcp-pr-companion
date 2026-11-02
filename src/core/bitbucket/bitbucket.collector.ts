import { createHash } from 'crypto';
import { BitbucketClient, BitbucketFetchOptions } from './bitbucket.client.js';
import { RawPRRevision } from './bitbucket.types.js';
import { ConfigManager } from '../../config/config.manager.js';
import { isPRDraft } from '../pr-status.js';
import { AccountPolicy } from '../auth/account-policy.js';
import { Logger } from '../../utils/logger.js';
import { SecretScanner } from '../privacy/secret.scanner.js';

/** The fields of one PR metadata response that freshness and the live review status need. */
export interface PRHead {
  source: string;
  destination: string;
  participants: any[];
  state: string;
  isDraft: boolean;
  /** The raw response, so a sync that follows can reuse it instead of fetching it again. Never returned by a tool. */
  metadata: any;
}

export class BitbucketCollector {
  /**
   * Account UUID per credential identity (a hash of email and token). Account identity, not PR data.
   * ponytail: kept for the process lifetime; a revoked token still fails on the next Bitbucket request.
   */
  private static userUuids = new Map<string, string>();
  private client: BitbucketClient;
  private identity: string;

  /**
   * Without explicit credentials (MCP server path), use BITBUCKET_EMAIL / BITBUCKET_API_TOKEN from .env or the Hub's bitbucket block
   * and enforce ALLOWED_EMAILS here (the CLI enforces it at login).
   */
  constructor(email?: string, token?: string) {
    if (!email || !token) {
      const creds = ConfigManager.credentials();
      email = email || creds.email;
      token = token || creds.token;
      if (!AccountPolicy.isEmailAllowed(email)) {
        throw new Error(`Access denied. BITBUCKET_EMAIL is not listed in ALLOWED_EMAILS (.env or the Hub's bitbucket block).`);
      }
    }
    if (!token) {
      throw new Error(`No Bitbucket credentials: set BITBUCKET_EMAIL and BITBUCKET_API_TOKEN in .env or the Hub's bitbucket block.`);
    }
    this.client = new BitbucketClient(email, token);
    this.identity = createHash('sha256').update(`${email ?? ''}
${token}`).digest('hex');
  }

  /** Throws unless the configured token authenticates (GET /user, read:user scope). The account is for internal use; tools never return it. */
  async checkConnection(): Promise<{ uuid: string }> {
    try {
      return await this.client.getCurrentUser();
    } catch (err: any) {
      if (err.status === 401) throw new Error(`Bitbucket rejected the credentials (HTTP 401): check BITBUCKET_EMAIL / BITBUCKET_API_TOKEN in .env or the Hub's bitbucket block.`);
      if (err.status === 403) throw new Error('Bitbucket token lacks the read:user scope (HTTP 403).');
      throw new Error(`Bitbucket is unreachable: ${SecretScanner.scanAndRedact(err.message || String(err))}`);
    }
  }

  /** UUID of the account behind the configured token (for "my PRs" discovery). One GET /user per credentials per process. */
  async currentUserUuid(): Promise<string> {
    const cached = BitbucketCollector.userUuids.get(this.identity);
    if (cached) return cached;
    const { uuid } = await this.checkConnection();
    if (uuid) BitbucketCollector.userUuids.set(this.identity, uuid);
    return uuid;
  }

  /** The repository UUID (ai-context key material). Errors are phrased as "No access" and never include the UUID. */
  async getRepositoryUuid(workspace: string, repoSlug: string): Promise<string> {
    try {
      return String((await this.client.getRepository(workspace, repoSlug)).uuid || '');
    } catch (err: any) {
      if (err.status === 401) throw new Error(`No access: Bitbucket rejected the credentials (HTTP 401): check BITBUCKET_EMAIL / BITBUCKET_API_TOKEN in .env or the Hub's bitbucket block.`);
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

  /** One metadata request: the PR's current source and target commit hashes (used to detect stale revisions). */
  async getHeadCommits(workspace: string, repoSlug: string, prId: number): Promise<PRHead> {
    return BitbucketCollector.headOf(await this.client.getPRMetadata(workspace, repoSlug, prId));
  }

  static headOf(metadata: any): PRHead {
    return {
      source: metadata?.source?.commit?.hash || 'unknown_source',
      destination: metadata?.destination?.commit?.hash || 'unknown_dest',
      participants: Array.isArray(metadata?.participants) ? metadata.participants : [],
      state: String(metadata?.state || 'OPEN'),
      isDraft: isPRDraft(metadata ?? {}),
      metadata
    };
  }

  /** Fetches the PR (metadata, then commits/diffstat/diff). Pass `metadata` from getHeadCommits to skip refetching it. */
  async collect(workspace: string, repoSlug: string, prId: number, options: BitbucketFetchOptions = {}, prefetchedMetadata?: any): Promise<RawPRRevision> {
    const warnings: string[] = [];

    // 1. Fetch Metadata
    let metadata: any = null;
    let metadataCoverage: 'complete' | 'failed' = 'failed';
    try {
      metadata = prefetchedMetadata ?? await this.client.getPRMetadata(workspace, repoSlug, prId, options);
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
