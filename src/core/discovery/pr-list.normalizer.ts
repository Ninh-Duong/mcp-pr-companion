import { PIISanitizer } from '../privacy/pii.sanitizer.js';
import { SecretScanner } from '../privacy/secret.scanner.js';
import { normalizeUuid } from '../auth/current-user.resolver.js';
import { isPRDraft } from '../pr-status.js';

export interface DiscoveredPR {
  id: number;
  title: string;
  state: string;
  isDraft: boolean;
  sourceBranch: string;
  targetBranch: string;
  sourceCommitHash?: string;
  destinationCommitHash?: string;
  updatedOn: string;
  authorUuid?: string;
  cacheStatus: 'Missing' | 'Cached' | 'Outdated';
}

export class PRListNormalizer {
  static normalizePR(rawPr: any, cacheStatus: 'Missing' | 'Cached' | 'Outdated'): DiscoveredPR {
    const title = rawPr.title ? SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(rawPr.title)) : 'Untitled PR';
    const sourceBranch = rawPr.source?.branch?.name || 'unknown';
    const targetBranch = rawPr.destination?.branch?.name || 'unknown';
    const sourceCommitHash = rawPr.source?.commit?.hash;
    const destinationCommitHash = rawPr.destination?.commit?.hash;

    // Use official API draft field if available
    const isDraft = isPRDraft(rawPr);

    const normAuthorUuid = normalizeUuid(rawPr.author?.uuid);

    return {
      id: rawPr.id,
      title,
      state: rawPr.state || 'OPEN',
      isDraft,
      sourceBranch,
      targetBranch,
      sourceCommitHash,
      destinationCommitHash,
      updatedOn: rawPr.updated_on || new Date().toISOString(),
      authorUuid: normAuthorUuid || undefined,
      cacheStatus
    };
  }
}
