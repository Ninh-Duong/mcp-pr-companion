import { select } from '@inquirer/prompts';
import { PRDiscoveryService } from '../core/discovery/pr-discovery.service.js';
import { DiscoveryCache } from '../core/discovery/discovery-cache.js';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { PRDetailScreen } from './pr-detail.screen.js';

export class PRListScreen {
  static async render(): Promise<void> {
    const session = runtimeSession.getSession();
    if (!session) {
      console.error('No active session.');
      return;
    }

    const { workspace, repoSlug } = session.repository;

    while (true) {
      console.clear();
      console.log(`\n================================================================`);
      console.log(`Pull Requests for ${workspace}/${repoSlug}`);
      console.log(`================================================================`);

      let prs = DiscoveryCache.getPRs();

      if (prs.length === 0) {
        console.log('Fetching open Pull Requests from Bitbucket API...');
        try {
          prs = await PRDiscoveryService.discoverOpenPRs(
            session.email,
            session.token,
            workspace,
            repoSlug,
            ''
          );
        } catch (err: any) {
          console.error(`Failed to fetch PR list: ${err.message || String(err)}`);
          await new Promise(r => setTimeout(r, 2000));
          return;
        }
      }

      console.log(`Found ${prs.length} open PR(s):\n`);

      prs.forEach((pr) => {
        const cacheStatus = DiscoveryCache.evaluateCacheStatus(
          workspace,
          repoSlug,
          pr.id,
          pr.updatedOn
        );
        const statusBadge =
          cacheStatus === 'Cached' ? '[CACHED]' : cacheStatus === 'Outdated' ? '[OUTDATED]' : '[MISSING]';
        console.log(`  ${statusBadge} #${pr.id}: ${pr.title} (${pr.sourceBranch} -> ${pr.targetBranch})`);
      });

      console.log(`----------------------------------------------------------------\n`);

      const choice = await select({
        message: 'Select action:',
        choices: [
          { name: '🔍 View PR Detail / Sync', value: 'view' },
          { name: '🔄 Refresh PR List from Bitbucket', value: 'refresh' },
          { name: '⬅️ Back to Main Menu', value: 'back' }
        ]
      });

      if (choice === 'back') {
        return;
      }

      if (choice === 'refresh') {
        DiscoveryCache.clear();
        continue;
      }

      if (choice === 'view') {
        const prChoices = prs.map((pr) => ({
          name: `#${pr.id} ${pr.title}`,
          value: pr.id
        }));

        const selectedPrId = await select({
          message: 'Select PR to view details:',
          choices: prChoices
        });

        const selectedPr = prs.find(p => p.id === selectedPrId);
        if (selectedPr) {
          await PRDetailScreen.render(selectedPr);
        }
      }
    }
  }
}
