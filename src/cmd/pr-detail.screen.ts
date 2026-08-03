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
        commits: active.manifest.stats.commits,
        files: active.manifest.stats.files,
        additions: active.manifest.stats.additions,
        deletions: active.manifest.stats.deletions,
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
      // Fallback on error
    }

    return { commits: 0, files: 0, additions: 0, deletions: 0, comments: 0 };
  }

  static async displayDetail(pr: DiscoveredPR): Promise<void> {
    console.log('\nLazy-loading PR statistics...');
    const stats = await this.fetchPRDetailStats(pr.id);

    while (true) {
      console.clear();
      console.log('========================================================');
      console.log(`PR #${pr.id}`);
      console.log('========================================================');
      console.log(`Title:       ${pr.title}`);
      console.log(`State:       ${pr.state} ${pr.isDraft ? '(Draft)' : ''}`);
      console.log(`Source:      ${pr.sourceBranch}`);
      console.log(`Target:      ${pr.targetBranch}`);
      console.log(`Updated:     ${pr.updatedOn}`);
      console.log(`Commits:     ${stats.commits}`);
      console.log(`Files:       ${stats.files}`);
      console.log(`Additions:   ${stats.additions}`);
      console.log(`Deletions:   ${stats.deletions}`);
      console.log(`Cache State: ${pr.cacheStatus}`);
      console.log('========================================================\n');

      const action = await select({
        message: 'Actions:',
        choices: [
          { name: '1. Back', value: 'back' }
        ]
      });

      if (action === 'back') {
        return;
      }
    }
  }
}
