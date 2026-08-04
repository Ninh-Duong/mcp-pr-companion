import { select, confirm, checkbox } from '@inquirer/prompts';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { DiscoveryCache } from '../core/discovery/discovery-cache.js';
import { DiscoveredPR } from '../core/discovery/pr-list.normalizer.js';
import { GenerationManager } from '../core/generation/generation.manager.js';
import { GenerationProgressRenderer } from './generation-progress.renderer.js';
import { TokenVerifyScreen } from './token-verify.screen.js';
import { DataStore } from '../core/storage/data.store.js';
import { PRReadinessFilter, PRViewFilter } from '../core/discovery/pr-view-filter.js';
import { PRDiscoveryService } from '../core/discovery/pr-discovery.service.js';

export class GenerateMenu {
  private static lastFailedPRs: DiscoveredPR[] = [];

  static async displayMenu(): Promise<void> {
    const session = runtimeSession.getSession();
    if (!session) return;

    const { email, token, currentUserUuid } = runtimeSession.getAuthenticatedIdentity();
    const { workspace, repoSlug } = session.repository;

    let selectedFilter: PRReadinessFilter = 'all';

    while (true) {
      let prs = DiscoveryCache.getPRs(currentUserUuid, workspace, repoSlug);
      if (prs.length === 0) {
        try {
          prs = await PRDiscoveryService.discoverOpenPRs(email, token, workspace, repoSlug, currentUserUuid);
        } catch {
          prs = [];
        }
      }

      const filteredPRs = PRViewFilter.apply(prs, currentUserUuid, selectedFilter);

      console.clear();
      console.log('========================================================');
      console.log('                 GENERATE PR DATA                       ');
      console.log('========================================================');
      console.log(`- Account:          ${email}`);
      console.log(`- Repository:       ${workspace}/${repoSlug}`);
      console.log(`- Readiness Filter: ${selectedFilter.toUpperCase()}`);
      console.log(`- Total Owned PRs:  ${prs.length}`);
      console.log(`- Filtered PRs:     ${filteredPRs.length}`);
      console.log('========================================================\n');

      const choices: Array<{ name: string; value: string }> = [
        { name: '1. Generate all matching PRs', value: 'all' },
        { name: '2. Select PRs to generate', value: 'select' },
        { name: '3. Generate new/outdated PRs only (Recommended)', value: 'outdated_only' },
        { name: '4. Change Readiness Scope (Ready/Draft/All)', value: 'change_filter' }
      ];

      if (this.lastFailedPRs.length > 0) {
        choices.push({ name: `5. Retry failed PRs (${this.lastFailedPRs.length})`, value: 'retry_failed' });
      }

      choices.push({ name: '6. ⬅️ Back to Main Menu', value: 'back' });

      const action = await select({
        message: 'Options:',
        choices
      });

      if (action === 'back') {
        return;
      }

      if (action === 'change_filter') {
        const nextFilter = await select<PRReadinessFilter | 'cancel'>({
          message: 'Select readiness filter for generation:',
          choices: [
            { name: '1. Open / Ready PRs (Exclude Drafts)', value: 'ready' },
            { name: '2. Draft PRs Only', value: 'draft' },
            { name: '3. All Open PRs (Ready + Draft)', value: 'all' },
            { name: '4. ⬅️ Cancel', value: 'cancel' }
          ]
        });

        if (nextFilter !== 'cancel') {
          selectedFilter = nextFilter;
        }
        continue;
      }

      let prsToGenerate: DiscoveredPR[] = [];

      if (action === 'all') {
        prsToGenerate = filteredPRs;
      } else if (action === 'outdated_only') {
        prsToGenerate = filteredPRs.filter(p => p.cacheStatus !== 'Cached');
      } else if (action === 'retry_failed') {
        prsToGenerate = this.lastFailedPRs;
      } else if (action === 'select') {
        if (filteredPRs.length === 0) {
          console.log('\nNo matching PRs available to select.');
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        const selectedIds = await checkbox({
          message: 'Select pull requests to generate (Space to select, Enter to confirm):',
          choices: filteredPRs.map(p => ({
            name: `${p.isDraft ? '[DRAFT]' : '[READY]'} #${p.id} ${p.title} [${p.cacheStatus}]`,
            value: p.id
          }))
        });

        if (selectedIds.length === 0) {
          console.log('\nNo pull requests selected. Generation cancelled.');
          await new Promise(r => setTimeout(r, 1500));
          continue;
        }

        prsToGenerate = filteredPRs.filter(p => selectedIds.includes(p.id));
      }

      if (prsToGenerate.length === 0) {
        console.log('\nNo PRs match criteria for generation.');
        await new Promise((res) => setTimeout(res, 1500));
        continue;
      }

      // Step 1: Token scope verification & approval
      const tokenValid = await TokenVerifyScreen.verifyOrUpdateToken();
      if (tokenValid !== 'valid') {
        console.log('\nGeneration cancelled: Token verification failed or cancelled by user.');
        await new Promise((res) => setTimeout(res, 2000));
        continue;
      }

      // Step 2: Check for existing local data conflicts
      let strategy: 'overwrite' | 'new_version' = 'overwrite';
      const existingPRs = prsToGenerate.filter((pr) => {
        const active = DataStore.getActiveRevision(
          session.repository.workspace,
          session.repository.repoSlug,
          pr.id
        );
        return active !== null;
      });

      if (existingPRs.length > 0) {
        console.log(`\nNotice: ${existingPRs.length} selected PR(s) already have local data generated.`);
        const strategyChoice = await select({
          message: 'Choose how to handle existing PR data:',
          choices: [
            { name: '1. Overwrite existing data (Replace in place)', value: 'overwrite' },
            { name: '2. Create new version (Preserve history & update latest version)', value: 'new_version' },
            { name: '3. Skip PRs with existing data', value: 'skip' },
            { name: '4. ⬅️ Cancel and return to Generate menu', value: 'cancel' }
          ]
        });

        if (strategyChoice === 'cancel') {
          continue;
        }

        if (strategyChoice === 'skip') {
          prsToGenerate = prsToGenerate.filter((pr) => {
            return !DataStore.getActiveRevision(
              session.repository.workspace,
              session.repository.repoSlug,
              pr.id
            );
          });

          if (prsToGenerate.length === 0) {
            console.log('\nAll selected PRs already have local data and were skipped.');
            await new Promise((res) => setTimeout(res, 2000));
            continue;
          }
        } else {
          strategy = strategyChoice as 'overwrite' | 'new_version';
        }
      }

      // Confirmation screen
      console.log(`\nGeneration Plan Summary:`);
      console.log(`- Selected PRs:           ${prsToGenerate.length}`);
      console.log(`- Conflict strategy:      ${strategy === 'new_version' ? 'Create new version' : 'Overwrite'}`);
      console.log(`- Expected generations:   ${prsToGenerate.length}\n`);

      const shouldProceed = await confirm({
        message: 'Start PR Data Generation?',
        default: true
      });

      if (!shouldProceed) {
        continue;
      }

      // Execute batch generation
      const result = await GenerationManager.executeBatch(
        session.email,
        session.token,
        session.repository.workspace,
        session.repository.repoSlug,
        prsToGenerate,
        2,
        true, // forceRefresh since user confirmed generation
        strategy,
        (progress) => {
          GenerationProgressRenderer.render(progress);
        }
      );

      this.lastFailedPRs = result.failedPRs;

      console.log('\nGeneration complete!');
      console.log(`Completed: ${result.completed} | Cached: ${result.cached} | Failed: ${result.failed}`);
      console.log(`Log: ${result.logFilePath}\n`);

      await select({
        message: 'Press Enter to return to Generate menu:',
        choices: [{ name: 'Back to menu', value: 'ok' }]
      });
    }
  }
}
