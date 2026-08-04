import { PIISanitizer } from '../privacy/pii.sanitizer.js';
import { Redactor } from '../../utils/redactor.js';
import { normalizeUuid } from '../auth/current-user.resolver.js';

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
    const title = rawPr.title ? Redactor.redact(PIISanitizer.sanitizeText(rawPr.title)) : 'Untitled PR';
    const sourceBranch = rawPr.source?.branch?.name || 'unknown';
    const targetBranch = rawPr.destination?.branch?.name || 'unknown';
    const sourceCommitHash = rawPr.source?.commit?.hash;
    const destinationCommitHash = rawPr.destination?.commit?.hash;

    // Use official API draft field if available
    let isDraft = false;
    if (typeof rawPr.draft === 'boolean') {
      isDraft = rawPr.draft;
    } else if (typeof rawPr.is_draft === 'boolean') {
      isDraft = rawPr.is_draft;
    } else {
      isDraft = Boolean(rawPr.title?.toLowerCase().includes('[draft]') || rawPr.title?.toLowerCase().startsWith('draft:'));
    }

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
