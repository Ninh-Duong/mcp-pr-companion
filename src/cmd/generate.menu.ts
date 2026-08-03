import { select, confirm, checkbox } from '@inquirer/prompts';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { DiscoveryCache } from '../core/discovery/discovery-cache.js';
import { DiscoveredPR } from '../core/discovery/pr-list.normalizer.js';
import { GenerationManager } from '../core/generation/generation.manager.js';
import { GenerationProgressRenderer } from './generation-progress.renderer.js';
import { TokenVerifyScreen } from './token-verify.screen.js';
import { DataStore } from '../core/storage/data.store.js';

export class GenerateMenu {
  private static lastFailedPRs: DiscoveredPR[] = [];

  static async displayMenu(): Promise<void> {
    const session = runtimeSession.getSession();
    if (!session) return;

    while (true) {
      const prs = DiscoveryCache.getPRs();
      console.clear();
      console.log('========================================================');
      console.log('                 GENERATE PR DATA                       ');
      console.log('========================================================');
      console.log('Current filter:');
      console.log(`- Account:    Authenticated (${session.displayName || 'User'})`);
      console.log(`- Repository: ${session.repository.opaqueId}`);
      console.log(`- State:      Open`);
      console.log(`- PR count:   ${prs.length}`);
      console.log('========================================================\n');

      const choices: Array<{ name: string; value: string }> = [
        { name: '1. Generate all PRs', value: 'all' },
        { name: '2. Select PRs to generate', value: 'select' },
        { name: '3. Generate new/outdated PRs only (Recommended)', value: 'outdated_only' }
      ];

      if (this.lastFailedPRs.length > 0) {
        choices.push({ name: `4. Retry failed PRs (${this.lastFailedPRs.length})`, value: 'retry_failed' });
      }

      choices.push({ name: '5. Back', value: 'back' });

      const action = await select({
        message: 'Options:',
        choices
      });

      if (action === 'back') {
        return;
      }

      let prsToGenerate: DiscoveredPR[] = [];

      if (action === 'all') {
        prsToGenerate = prs;
      } else if (action === 'outdated_only') {
        prsToGenerate = prs.filter(p => p.cacheStatus !== 'Cached');
      } else if (action === 'retry_failed') {
        prsToGenerate = this.lastFailedPRs;
      } else if (action === 'select') {
        if (prs.length === 0) {
          console.log('\nNo PRs available to select.');
          continue;
        }

        const selectedIds = await checkbox({
          message: 'Select pull requests to generate:',
          choices: prs.map(p => ({
            name: `#${p.id} ${p.title} [${p.cacheStatus}]`,
            value: p.id
          }))
        });

        if (selectedIds.length === 0) {
          console.log('\nNo pull requests selected.');
          continue;
        }

        prsToGenerate = prs.filter(p => selectedIds.includes(p.id));
      }

      if (prsToGenerate.length === 0) {
        console.log('\nNo PRs match criteria for generation.');
        await new Promise((res) => setTimeout(res, 1500));
        continue;
      }

      // Step 1: Token scope verification & approval
      const tokenValid = await TokenVerifyScreen.verifyOrUpdateToken();
      if (!tokenValid) {
        console.log('\nGeneration cancelled: API token does not have required read permissions.');
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
            { name: '3. Skip PRs with existing data', value: 'skip' }
          ]
        });

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
      const cachedCount = prsToGenerate.filter(p => p.cacheStatus === 'Cached').length;
      const outdatedCount = prsToGenerate.filter(p => p.cacheStatus === 'Outdated').length;
      const missingCount = prsToGenerate.filter(p => p.cacheStatus === 'Missing').length;

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
