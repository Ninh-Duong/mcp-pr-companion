import { isPRDraft } from '../pr-status.js';

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
  conflict?: boolean;
  lines_added: number;
  lines_removed: number;
  old_path?: string;
  new_path?: string;
}

export class BitbucketAllowlistProjector {
  static readonly MAX_DESCRIPTION_CHARS = 4000;
  static readonly MAX_COMMIT_SUBJECT_CHARS = 200;

  /** Caps the description but says so: a silent cut would drop acceptance criteria without a trace. */
  static truncateDescription(raw: unknown): string {
    const text = String(raw || '').trim();
    if (text.length <= this.MAX_DESCRIPTION_CHARS) return text;
    return `${text.substring(0, this.MAX_DESCRIPTION_CHARS).trim()}\n\n_[description truncated: ${this.MAX_DESCRIPTION_CHARS} of ${text.length} chars]_`;
  }

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
      description: String(raw.description || '').trim(),
      state: raw.state || 'open',
      draft: isPRDraft(raw),
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

    // Merge commits ("Merge branch …") say nothing about the change and would eat the cap.
    // Bitbucket returns PR commits oldest first; keep the newest useful subjects for the context pack.
    const max = Math.max(0, Math.floor(maxSubjects));
    const useful = rawCommits.filter((c: any) => (c.parents?.length ?? 0) < 2);
    const latest = max === 0 ? [] : useful.slice(-max).reverse();
    return latest.map((c: any) => {
      const fullMsg = c.message || '';
      return {
        hash: c.hash || '',
        subject: fullMsg.split('\n')[0].trim()
      };
    });
  }

  /** Call after sanitizing complete source text so a cutoff cannot expose part of a secret or identifier. */
  static truncateCommitSubject(text: string): string {
    const marker = '… [truncated]';
    return text.length > this.MAX_COMMIT_SUBJECT_CHARS
      ? `${text.slice(0, this.MAX_COMMIT_SUBJECT_CHARS - marker.length).trimEnd()}${marker}`
      : text;
  }

  static projectDiffstat(rawDiffstat: any[] = []): ProjectedDiffstatItem[] {
    if (!Array.isArray(rawDiffstat)) return [];

    // Bitbucket also reports "merge conflict", "local deleted", "remote deleted", "local and remote deleted";
    // the v4 index only knows four statuses, so map them and keep the conflict as a flag.
    const KNOWN = ['added', 'modified', 'removed', 'renamed'];
    return rawDiffstat.map((item: any) => ({
      status: String(item.status || 'modified').includes('deleted') ? 'removed' : KNOWN.includes(item.status) ? item.status : 'modified',
      ...(item.status === 'merge conflict' ? { conflict: true } : {}),
      lines_added: item.lines_added || 0,
      lines_removed: item.lines_removed || 0,
      old_path: item.old?.path,
      new_path: item.new?.path
    }));
  }
}
