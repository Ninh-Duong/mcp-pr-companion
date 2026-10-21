export const PR_STORAGE_STATUSES = ['open', 'draft', 'merged', 'declined'] as const;

export type PRStorageStatus = typeof PR_STORAGE_STATUSES[number];
export type PRSyncMode = PRStorageStatus | 'all';

export function isPRDraft(metadata: { draft?: unknown; is_draft?: unknown; title?: string }): boolean {
  if (typeof metadata.draft === 'boolean') return metadata.draft;
  if (typeof metadata.is_draft === 'boolean') return metadata.is_draft;
  const title = metadata.title?.toLowerCase() || '';
  return title.includes('[draft]') || title.startsWith('draft:');
}

export function getPRStorageStatus(state: string, isDraft: boolean): PRStorageStatus {
  switch (state.toUpperCase()) {
    case 'OPEN': return isDraft ? 'draft' : 'open';
    case 'MERGED': return 'merged';
    case 'DECLINED': return 'declined';
    default: throw new Error(`Unsupported Bitbucket pull request state: ${state}`);
  }
}
