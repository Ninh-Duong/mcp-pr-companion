import { BitbucketClient } from '../bitbucket/bitbucket.client.js';
import { PRFilterBuilder } from './pr-filter.builder.js';
import { PRListNormalizer, DiscoveredPR } from './pr-list.normalizer.js';
import { DiscoveryCache } from './discovery-cache.js';
import { normalizeUuid } from '../auth/current-user.resolver.js';
import { PROwnershipPolicy } from '../auth/pr-ownership.policy.js';
import { SecretScanner } from '../privacy/secret.scanner.js';

export interface DiscoveryContext {
  identity: {
    email: string;
    token: string;
    currentUserUuid: string;
  };
  repository: {
    workspace: string;
    repoSlug: string;
  };
}

export type BitbucketPRState = 'OPEN' | 'MERGED' | 'DECLINED';

export interface DiscoveryResult {
  prs: DiscoveredPR[];
  complete: boolean;
  warnings: string[];
}

export class PRDiscoveryService {
  /** Pages (50 PRs each) the unfiltered fallback listing reads when the author-filtered query returns nothing. */
  static readonly FALLBACK_MAX_PAGES = 2;

  private static context(
    emailOrContext: string | DiscoveryContext,
    token?: string,
    workspace?: string,
    repoSlug?: string,
    currentUserUuid?: string
  ): DiscoveryContext {
    if (typeof emailOrContext === 'object') return emailOrContext;
    return {
      identity: { email: emailOrContext, token: token || '', currentUserUuid: currentUserUuid || '' },
      repository: { workspace: workspace || '', repoSlug: repoSlug || '' }
    };
  }

  static async discoverMyPRs(
    emailOrContext: string | DiscoveryContext,
    token?: string,
    workspace?: string,
    repoSlug?: string,
    currentUserUuid?: string,
    states: BitbucketPRState[] = ['OPEN']
  ): Promise<DiscoveryResult> {
    const context = this.context(emailOrContext, token, workspace, repoSlug, currentUserUuid);
    const { email, token: apiToken } = context.identity;
    const { workspace: ws, repoSlug: repo } = context.repository;
    const userUuid = normalizeUuid(context.identity.currentUserUuid);
    if (!userUuid) throw new Error('Authenticated user UUID is required for PR discovery. Cannot perform anonymous/unbound query.');

    const client = new BitbucketClient(email, apiToken);
    const query = PRFilterBuilder.buildQuery(userUuid);
    const prs: DiscoveredPR[] = [];
    const warnings: string[] = [];
    let complete = true;

    for (const state of [...new Set(states)]) {
      let page = await client.listPullRequests(ws, repo, query, state);
      if (page.values.length === 0 && page.isComplete) {
        // The author filter is authoritative; this unfiltered fallback only guards against a query Bitbucket
        // ignored, so it reads the newest pages and labels a cut-off listing instead of scanning the whole repository.
        page = await client.listPullRequests(ws, repo, '', state, { maxPages: this.FALLBACK_MAX_PAGES });
        if (!page.isComplete && page.warnings.length === 0) {
          warnings.push(`Fallback listing incomplete: the author filter returned no ${state} pull requests; checked only the ${this.FALLBACK_MAX_PAGES} newest pages of all ${state} pull requests.`);
          page = { ...page, isComplete: true };
        }
      }
      complete &&= page.isComplete;
      warnings.push(...page.warnings.map(w => SecretScanner.scanAndRedact(w)));
      prs.push(...page.values
        .filter((pr: any) => PROwnershipPolicy.belongsToUser(pr.author?.uuid, userUuid))
        .map((rawPr: any) => {
          const cacheStatus = DiscoveryCache.evaluateCacheStatus(
            ws,
            repo,
            rawPr.id,
            rawPr.updated_on,
            rawPr.source?.commit?.hash,
            rawPr.destination?.commit?.hash
          );
          return PRListNormalizer.normalizePR(rawPr, cacheStatus);
        }));
    }

    DiscoveryCache.setPRs(userUuid, ws, repo, prs);
    return { prs, complete, warnings };
  }

  static async discoverOpenPRs(
    emailOrContext: string | DiscoveryContext,
    token?: string,
    workspace?: string,
    repoSlug?: string,
    currentUserUuid?: string
  ): Promise<DiscoveredPR[]> {
    return (await this.discoverOpenPRsWithWarnings(emailOrContext, token, workspace, repoSlug, currentUserUuid)).prs;
  }

  /** Open PRs plus the warnings of a complete listing (e.g. a cut-off fallback). An incomplete listing throws. */
  static async discoverOpenPRsWithWarnings(
    emailOrContext: string | DiscoveryContext,
    token?: string,
    workspace?: string,
    repoSlug?: string,
    currentUserUuid?: string
  ): Promise<{ prs: DiscoveredPR[]; warnings: string[] }> {
    const result = await this.discoverMyPRs(emailOrContext, token, workspace, repoSlug, currentUserUuid, ['OPEN']);
    if (!result.complete) {
      const context = this.context(emailOrContext, token, workspace, repoSlug, currentUserUuid);
      const { workspace: ws, repoSlug: repo } = context.repository;
      throw new Error(`Could not list pull requests for ${ws}/${repo}: discovery was incomplete: ${result.warnings.join('; ') || 'Bitbucket pagination stopped early.'}`);
    }
    return { prs: result.prs, warnings: result.warnings };
  }
}
