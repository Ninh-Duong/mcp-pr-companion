export interface ProjectedMetadata {
  id: number;
  title: string;
  description: string;
  state: string;
  draft?: boolean;
  source: {
    branch: { name: string };
    commit: { hash: string };
  };
  destination: {
    branch: { name: string };
    commit: { hash: string };
  };
  author?: {
    display_name?: string;
  };
}

export interface ProjectedCommit {
  hash: string;
  subject: string;
}

export interface ProjectedDiffstatItem {
  status: string;
  lines_added: number;
  lines_removed: number;
  old_path?: string;
  new_path?: string;
}

export class BitbucketAllowlistProjector {
  static projectMetadata(raw: any, removeAuthor = true): ProjectedMetadata {
    if (!raw) {
      return {
        id: 0,
        title: '',
        description: '',
        state: 'open',
        source: { branch: { name: '' }, commit: { hash: '' } },
        destination: { branch: { name: '' }, commit: { hash: '' } }
      };
    }

    const projected: ProjectedMetadata = {
      id: raw.id || 0,
      title: (raw.title || '').trim(),
      description: (raw.description || '').substring(0, 1000).trim(),
      state: raw.state || 'open',
      draft: Boolean(raw.draft),
      source: {
        branch: { name: raw.source?.branch?.name || '' },
        commit: { hash: raw.source?.commit?.hash || '' }
      },
      destination: {
        branch: { name: raw.destination?.branch?.name || '' },
        commit: { hash: raw.destination?.commit?.hash || '' }
      }
    };

    if (!removeAuthor && raw.author) {
      projected.author = {
        display_name: raw.author.display_name || raw.author.username
      };
    }

    return projected;
  }

  static projectCommits(rawCommits: any[] = [], maxSubjects = 10): ProjectedCommit[] {
    if (!Array.isArray(rawCommits)) return [];

    return rawCommits.slice(0, maxSubjects).map((c: any) => {
      const fullMsg = c.message || '';
      const subject = fullMsg.split('\n')[0].trim();
      return {
        hash: c.hash || '',
        subject
      };
    });
  }

  static projectDiffstat(rawDiffstat: any[] = []): ProjectedDiffstatItem[] {
    if (!Array.isArray(rawDiffstat)) return [];

    return rawDiffstat.map((item: any) => ({
      status: item.status || 'modified',
      lines_added: item.lines_added || 0,
      lines_removed: item.lines_removed || 0,
      old_path: item.old?.path,
      new_path: item.new?.path
    }));
  }
}
