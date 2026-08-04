import { ApiTokenAuth } from '../auth/api-token.auth.js';
import { PRFilterBuilder } from './pr-filter.builder.js';
import { PRListNormalizer, DiscoveredPR } from './pr-list.normalizer.js';
import { DiscoveryCache } from './discovery-cache.js';
import { normalizeUuid } from '../auth/current-user.resolver.js';
import { PROwnershipPolicy } from '../auth/pr-ownership.policy.js';

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

    const headers = ApiTokenAuth.getAuthHeaders(reqEmail, reqToken);
    const query = PRFilterBuilder.buildQuery(normUserUuid);
    const primaryUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(reqWorkspace)}/${encodeURIComponent(reqRepoSlug)}/pullrequests?q=${encodeURIComponent(query)}&sort=-updated_on&pagelen=50`;

    let rawValues: any[] = [];

    try {
      const res = await fetch(primaryUrl, { headers });
      if (res.ok) {
        const data: any = await res.json();
        rawValues = data.values || [];
      }
    } catch {
      rawValues = [];
    }

    // Client-side fallback if server-side query returned empty or failed
    if (rawValues.length === 0) {
      const fallbackUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(reqWorkspace)}/${encodeURIComponent(reqRepoSlug)}/pullrequests?q=state%3D%22OPEN%22&sort=-updated_on&pagelen=50`;
      try {
        const res = await fetch(fallbackUrl, { headers });
        if (res.ok) {
          const data: any = await res.json();
          rawValues = data.values || [];
        }
      } catch {
        rawValues = [];
      }
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
