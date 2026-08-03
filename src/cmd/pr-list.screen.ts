import { select } from '@inquirer/prompts';
import { DiscoveredPR } from '../core/discovery/pr-list.normalizer.js';
import { DiscoveryCache } from '../core/discovery/discovery-cache.js';
import { PRDiscoveryService } from '../core/discovery/pr-discovery.service.js';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { PRDetailScreen } from './pr-detail.screen.js';

export class PRListScreen {
  static formatRelativeTime(dateStr: string): string {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${diffMins} minutes ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours} hours ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} days ago`;
  }

  static renderPRList(prs: DiscoveredPR[]): void {
    console.clear();
    console.log('========================================================');
    console.log('                MY OPEN PULL REQUESTS                   ');
    console.log('========================================================\n');

    if (prs.length === 0) {
      console.log('No open pull requests found for your account.\n');
      return;
    }

    prs.forEach((pr, index) => {
      const draftLabel = pr.isDraft ? 'Draft ' : 'Open ';
      const updatedText = this.formatRelativeTime(pr.updatedOn);
      console.log(`[${index + 1}] #${pr.id} ${pr.title}`);
      console.log(`    ${draftLabel}${pr.sourceBranch} → ${pr.targetBranch}`);
      console.log(`    Updated: ${updatedText} | Local cache: ${pr.cacheStatus}\n`);
    });
  }

  static async displayMenu(): Promise<void> {
    const session = runtimeSession.getSession();
    if (!session) return;

    let prs = DiscoveryCache.getPRs();

    while (true) {
      this.renderPRList(prs);

      const action = await select({
        message: 'Actions:',
        choices: [
          { name: '1. Refresh', value: 'refresh' },
          { name: '2. View PR details', value: 'view_details' },
          { name: '3. Back', value: 'back' }
        ]
      });

      if (action === 'back') {
        return;
      }

      if (action === 'refresh') {
        console.log('\nRefreshing pull requests...');
        prs = await PRDiscoveryService.discoverOpenPRs(
          session.email,
          session.token,
          session.repository.workspace,
          session.repository.repoSlug,
          session.currentUserUuid
        );
      } else if (action === 'view_details') {
        if (prs.length === 0) {
          console.log('\nNo pull requests to view.');
          continue;
        }

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
          await PRDetailScreen.displayDetail(selectedPr);
        }
      }
    }
  }
}
