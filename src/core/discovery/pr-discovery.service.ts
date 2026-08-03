import { ApiTokenAuth } from '../auth/api-token.auth.js';
import { PRFilterBuilder } from './pr-filter.builder.js';
import { PRListNormalizer, DiscoveredPR } from './pr-list.normalizer.js';
import { DiscoveryCache } from './discovery-cache.js';

export class PRDiscoveryService {
  static async discoverOpenPRs(
    email: string,
    token: string,
    workspace: string,
    repoSlug: string,
    currentUserUuid: string
  ): Promise<DiscoveredPR[]> {
    const headers = ApiTokenAuth.getAuthHeaders(email, token);
    const query = PRFilterBuilder.buildQuery(currentUserUuid);
    const primaryUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests?q=${encodeURIComponent(query)}&sort=-updated_on`;

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

    // Client-side fallback if server-side filtering returned empty or failed
    if (rawValues.length === 0) {
      const fallbackUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests?q=state%3D%22OPEN%22&sort=-updated_on`;
      try {
        const res = await fetch(fallbackUrl, { headers });
        if (res.ok) {
          const data: any = await res.json();
          const allOpen = data.values || [];

          const cleanUserUuid = currentUserUuid.replace(/[{}]/g, '').toLowerCase();
          rawValues = allOpen.filter((pr: any) => {
            const authorUuid = pr.author?.uuid?.replace(/[{}]/g, '').toLowerCase();
            return authorUuid === cleanUserUuid;
          });
        }
      } catch {
        // Return empty array
      }
    }

    const normalizedList: DiscoveredPR[] = rawValues.map((rawPr: any) => {
      const cacheStatus = DiscoveryCache.evaluateCacheStatus(
        workspace,
        repoSlug,
        rawPr.id,
        rawPr.updated_on,
        rawPr.source?.commit?.hash,
        rawPr.destination?.commit?.hash
      );
      return PRListNormalizer.normalizePR(rawPr, cacheStatus);
    });

    DiscoveryCache.setPRs(normalizedList);
    return normalizedList;
  }
}
