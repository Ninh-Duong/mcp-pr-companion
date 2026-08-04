import { select } from '@inquirer/prompts';
import { DiscoveredPR } from '../core/discovery/pr-list.normalizer.js';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { ApiTokenAuth } from '../core/auth/api-token.auth.js';
import { DataStore } from '../core/storage/data.store.js';

export class PRDetailScreen {
  static async fetchPRDetailStats(prId: number): Promise<{
    commits: number;
    files: number;
    additions: number;
    deletions: number;
    comments: number;
  }> {
    const session = runtimeSession.getSession();
    if (!session) {
      return { commits: 0, files: 0, additions: 0, deletions: 0, comments: 0 };
    }

    const { workspace, repoSlug } = session.repository;

    // Check active local revision first
    const active = DataStore.getActiveRevision(workspace, repoSlug, prId);
    if (active && active.manifest) {
      return {
        commits: active.manifest.stats.commits_count,
        files: active.manifest.stats.files_changed,
        additions: active.manifest.change_summary.total_additions,
        deletions: active.manifest.change_summary.total_deletions,
        comments: 0
      };
    }

    // Lazy load stats from API
    const headers = ApiTokenAuth.getAuthHeaders(session.email, session.token);
    try {
      const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests/${prId}/diffstat`;
      const res = await fetch(url, { headers });
      if (res.ok) {
        const data: any = await res.json();
        const diffstat = data.values || [];
        let additions = 0;
        let deletions = 0;
        diffstat.forEach((item: any) => {
          additions += item.lines_added || 0;
          deletions += item.lines_removed || 0;
        });

        return {
          commits: 1,
          files: diffstat.length,
          additions,
          deletions,
          comments: 0
        };
      }
    } catch {
      // Fallback on network failure
    }

    return { commits: 0, files: 0, additions: 0, deletions: 0, comments: 0 };
  }

  static async render(pr: DiscoveredPR): Promise<'back' | 'sync'> {
    console.clear();
    console.log(`\n================================================================`);
    console.log(`PR #${pr.id}: ${pr.title}`);
    console.log(`================================================================`);
    console.log(`Branch      : ${pr.sourceBranch} -> ${pr.targetBranch}`);
    console.log(`Author      : ${pr.authorUuid || 'Unknown'}`);
    console.log(`State       : ${pr.state}`);
    console.log(`Updated At  : ${new Date(pr.updatedOn).toLocaleString()}`);

    const stats = await this.fetchPRDetailStats(pr.id);
    console.log(`\nStats Summary:`);
    console.log(`  - Commits : ${stats.commits}`);
    console.log(`  - Files   : ${stats.files}`);
    console.log(`  - Lines   : +${stats.additions} / -${stats.deletions}`);
    console.log(`----------------------------------------------------------------\n`);

    const action = await select({
      message: 'Select action for this PR:',
      choices: [
        { name: '🔄 Sync / Re-fetch PR Context Data', value: 'sync' },
        { name: '⬅️ Back to PR List', value: 'back' }
      ]
    });

    return action;
  }
}
