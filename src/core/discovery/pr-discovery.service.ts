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

export class PRDiscoveryService {
  static async discoverOpenPRs(
    emailOrContext: string | DiscoveryContext,
    token?: string,
    workspace?: string,
    repoSlug?: string,
    currentUserUuid?: string
  ): Promise<DiscoveredPR[]> {
    let reqEmail = '';
    let reqToken = '';
    let reqWorkspace = '';
    let reqRepoSlug = '';
    let reqUserUuid = '';

    if (typeof emailOrContext === 'object') {
      reqEmail = emailOrContext.identity.email;
      reqToken = emailOrContext.identity.token;
      reqUserUuid = emailOrContext.identity.currentUserUuid;
      reqWorkspace = emailOrContext.repository.workspace;
      reqRepoSlug = emailOrContext.repository.repoSlug;
    } else {
      reqEmail = emailOrContext;
      reqToken = token || '';
      reqWorkspace = workspace || '';
      reqRepoSlug = repoSlug || '';
      reqUserUuid = currentUserUuid || '';
    }

    const normUserUuid = normalizeUuid(reqUserUuid);
    if (!normUserUuid) {
      throw new Error('Authenticated user UUID is required for PR discovery. Cannot perform anonymous/unbound query.');
    }

    const client = new BitbucketClient(reqEmail, reqToken);
    const byAuthor = await client.listPullRequests(reqWorkspace, reqRepoSlug, PRFilterBuilder.buildQuery(normUserUuid));
    let rawValues = byAuthor.values;

    // Client-side fallback if the server-side author query returned nothing (or failed)
    if (rawValues.length === 0) {
      const open = await client.listPullRequests(reqWorkspace, reqRepoSlug, 'state="OPEN"');
      // Pagination turns HTTP errors into warnings: an empty, incomplete answer is a failure, not "no PRs".
      if (!open.isComplete && open.values.length === 0) {
        const why = open.warnings[0] ?? byAuthor.warnings[0] ?? 'unknown error';
        throw new Error(`Could not list pull requests for ${reqWorkspace}/${reqRepoSlug}: ${SecretScanner.scanAndRedact(why)}`);
      }
      rawValues = open.values;
    }

    // MANDATORY Client-Side Ownership Filter Across All Branches
    const ownedRawValues = rawValues.filter((pr: any) =>
      PROwnershipPolicy.belongsToUser(pr.author?.uuid, normUserUuid)
    );

    const normalizedList: DiscoveredPR[] = ownedRawValues.map((rawPr: any) => {
      const cacheStatus = DiscoveryCache.evaluateCacheStatus(
        reqWorkspace,
        reqRepoSlug,
        rawPr.id,
        rawPr.updated_on,
        rawPr.source?.commit?.hash,
        rawPr.destination?.commit?.hash
      );
      return PRListNormalizer.normalizePR(rawPr, cacheStatus);
    });

    DiscoveryCache.setPRs(normUserUuid, reqWorkspace, reqRepoSlug, normalizedList);
    return normalizedList;
  }
}
