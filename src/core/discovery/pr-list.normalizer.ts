import { PIISanitizer } from '../privacy/pii.sanitizer.js';
import { Redactor } from '../../utils/redactor.js';

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
    const isDraft = Boolean(rawPr.draft || rawPr.title?.toLowerCase().includes('draft'));

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
      authorUuid: rawPr.author?.uuid,
      cacheStatus
    };
  }
}
