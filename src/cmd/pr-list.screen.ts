import { select } from '@inquirer/prompts';
import { PRDiscoveryService } from '../core/discovery/pr-discovery.service.js';
import { DiscoveryCache } from '../core/discovery/discovery-cache.js';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { PRDetailScreen } from './pr-detail.screen.js';
import { PRReadinessFilter, PRViewFilter } from '../core/discovery/pr-view-filter.js';

export class PRListScreen {
  static async selectReadinessFilter(): Promise<PRReadinessFilter | 'back'> {
    console.clear();
    console.log(`\n================================================================`);
    console.log(`Select Pull Request Filter`);
    console.log(`================================================================\n`);

    const filterChoice = await select<PRReadinessFilter | 'back'>({
      message: 'Select readiness filter:',
      choices: [
        { name: '1. Open / Ready PRs (Exclude Drafts)', value: 'ready' },
        { name: '2. Draft PRs Only', value: 'draft' },
        { name: '3. All Open PRs (Ready + Draft)', value: 'all' },
        { name: '4. ⬅️ Back to Main Menu', value: 'back' }
      ]
    });

    return filterChoice;
  }

  static async render(initialFilter?: PRReadinessFilter): Promise<void> {
    const session = runtimeSession.getSession();
    if (!session) {
      console.error('No active session.');
      return;
    }

    const { email, currentUserUuid } = runtimeSession.getAuthenticatedIdentity();
    const { workspace, repoSlug } = session.repository;

    let currentFilter: PRReadinessFilter = initialFilter || 'all';

    // If no initial filter supplied, prompt user to pick filter first
    if (!initialFilter) {
      const selected = await this.selectReadinessFilter();
      if (selected === 'back') {
        return;
      }
      currentFilter = selected;
    }

    while (true) {
      console.clear();
      const filterLabel =
        currentFilter === 'ready'
          ? 'Open / Ready PRs Only'
          : currentFilter === 'draft'
          ? 'Draft PRs Only'
          : 'All Open PRs (Ready + Draft)';

      let allOwnedPRs = DiscoveryCache.getPRs(currentUserUuid, workspace, repoSlug);

      if (allOwnedPRs.length === 0) {
        console.log('Fetching open Pull Requests from Bitbucket API...');
        try {
          allOwnedPRs = await PRDiscoveryService.discoverOpenPRs(
            email,
            session.token,
            workspace,
            repoSlug,
            currentUserUuid
          );
        } catch (err: any) {
          console.error(`Failed to fetch PR list: ${err.message || String(err)}`);
          await new Promise(r => setTimeout(r, 2000));
          return;
        }
      }

      console.log(`\n================================================================`);
      console.log(`Pull Requests for ${workspace}/${repoSlug}`);
      console.log(`Account: ${email}`);
      console.log(`Ownership: Current account only`);
      console.log(`Filter: ${filterLabel}`);

      if (allOwnedPRs.length > 0) {
        const dates = allOwnedPRs
          .map((p) => new Date(p.updatedOn).getTime())
          .filter((d) => !isNaN(d));
        if (dates.length > 0) {
          const oldestMs = Math.min(...dates);
          const nowMs = Date.now();
          const daysSpan = Math.max(1, Math.ceil((nowMs - oldestMs) / (1000 * 60 * 60 * 24)));
          const oldestStr = new Date(oldestMs).toISOString().split('T')[0];
          console.log(`Date Range: Open PRs updated within the last ${daysSpan} day(s) (since ${oldestStr})`);
        }
      }
      console.log(`================================================================\n`);

      const visiblePRs = PRViewFilter.apply(allOwnedPRs, currentUserUuid, currentFilter);

      console.log(`Found ${visiblePRs.length} matching PR(s):\n`);

      if (visiblePRs.length === 0) {
        console.log(`  (No PRs found matching filter "${filterLabel}")\n`);
      } else {
        visiblePRs.forEach((pr) => {
          const cacheStatus = DiscoveryCache.evaluateCacheStatus(
            workspace,
            repoSlug,
            pr.id,
            pr.updatedOn
          );
          const statusBadge =
            cacheStatus === 'Cached' ? '[CACHED]' : cacheStatus === 'Outdated' ? '[OUTDATED]' : '[MISSING]';
          const draftBadge = pr.isDraft ? '[DRAFT]' : '[READY]';
          console.log(`  ${draftBadge} ${statusBadge} #${pr.id}: ${pr.title} (${pr.sourceBranch} -> ${pr.targetBranch})`);
        });
      }

      console.log(`\n----------------------------------------------------------------\n`);

      const choices: Array<{ name: string; value: string }> = [];

      if (visiblePRs.length > 0) {
        choices.push({ name: '🔍 View PR Detail / Sync', value: 'view' });
      }

      choices.push({ name: '⚙️  Change Readiness Filter', value: 'change_filter' });
      choices.push({ name: '🔄 Refresh PR List from Bitbucket', value: 'refresh' });
      choices.push({ name: '⬅️  Back to Main Menu', value: 'back' });

      const choice = await select({
        message: 'Select action:',
        choices
      });

      if (choice === 'back') {
        return;
      }

      if (choice === 'change_filter') {
        const nextFilter = await this.selectReadinessFilter();
        if (nextFilter !== 'back') {
          currentFilter = nextFilter;
        }
        continue;
      }

      if (choice === 'refresh') {
        DiscoveryCache.clearScope(currentUserUuid, workspace, repoSlug);
        continue;
      }

      if (choice === 'view' && visiblePRs.length > 0) {
        const prChoices = [
          ...visiblePRs.map((pr) => ({
            name: `${pr.isDraft ? '[DRAFT]' : '[READY]'} #${pr.id} ${pr.title}`,
            value: String(pr.id)
          })),
          { name: '⬅️ Back to PR actions', value: '__back__' }
        ];

        const selectedVal = await select({
          message: 'Select PR to view details:',
          choices: prChoices
        });

        if (selectedVal === '__back__') {
          continue;
        }

        const selectedPrId = parseInt(selectedVal, 10);
        const selectedPr = visiblePRs.find(p => p.id === selectedPrId);
        if (selectedPr) {
          await PRDetailScreen.render(selectedPr);
        }
      }
    }
  }
}
