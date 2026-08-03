import { select, input, confirm } from '@inquirer/prompts';
import { PRRegistry } from '../core/registry/pr.registry.js';

export class PRListMenu {
  static async show(): Promise<void> {
    let running = true;
    while (running) {
      const choice = await select({
        message: '📋 PR Link Registry Menu',
        choices: [
          { name: '1. List PR Links', value: 'list' },
          { name: '2. Add PR Link', value: 'add' },
          { name: '3. Remove PR Link', value: 'remove' },
          { name: '4. Validate All Links', value: 'validate' },
          { name: '5. Remove Duplicate Links', value: 'dedup' },
          { name: '6. Clear All Links', value: 'clear' },
          { name: '7. Back to Main Menu', value: 'back' }
        ]
      });

      switch (choice) {
        case 'list':
          this.listPRs();
          break;
        case 'add':
          await this.addPR();
          break;
        case 'remove':
          await this.removePR();
          break;
        case 'validate':
          this.validateLinks();
          break;
        case 'dedup':
          this.removeDuplicates();
          break;
        case 'clear':
          await this.clearLinks();
          break;
        case 'back':
          running = false;
          break;
      }
    }
  }

  private static listPRs(): void {
    const items = PRRegistry.list();
    console.log(`\nRegistered PR Links (${items.length} total):`);
    if (items.length === 0) {
      console.log('  (No PR links added yet)\n');
      return;
    }

    items.forEach((url, i) => {
      try {
        const parsed = PRRegistry.parseAndValidateUrl(url);
        console.log(`  ${i + 1}. ${parsed.workspace}/${parsed.repoSlug} #${parsed.prId}`);
      } catch {
        console.log(`  ${i + 1}. ${url}`);
      }
    });
    console.log();
  }

  private static async addPR(): Promise<void> {
    const urlInput = await input({
      message: 'Enter Bitbucket PR URL (e.g. https://bitbucket.org/workspace/repo/pull-requests/123):'
    });

    if (!urlInput || !urlInput.trim()) return;

    try {
      const res = PRRegistry.add(urlInput.trim());
      if (res.success) {
        console.log(`✅ ${res.message}\n`);
      } else {
        console.log(`⚠️ ${res.message}\n`);
      }
    } catch (err: any) {
      console.log(`❌ Error adding PR URL: ${err.message || String(err)}\n`);
    }
  }

  private static async removePR(): Promise<void> {
    const items = PRRegistry.list();
    if (items.length === 0) {
      console.log('\n(PR registry is empty)\n');
      return;
    }

    const choices = items.map((url, i) => ({
      name: `${i + 1}. ${url}`,
      value: url
    }));
    choices.push({ name: 'Cancel', value: 'cancel' });

    const selectedUrl = await select({
      message: 'Select PR Link to remove:',
      choices
    });

    if (selectedUrl === 'cancel') return;

    const res = PRRegistry.remove(selectedUrl);
    console.log(`✅ ${res.message}\n`);
  }

  private static validateLinks(): void {
    const res = PRRegistry.validateAll();
    console.log(`\nValidation Results -> Valid: ${res.valid.length}, Invalid: ${res.invalid.length}`);
    if (res.invalid.length > 0) {
      console.log('Invalid URLs:');
      res.invalid.forEach(inv => console.log(`  - ${inv.url}: ${inv.error}`));
    }
    console.log();
  }

  private static removeDuplicates(): void {
    const res = PRRegistry.deduplicate();
    console.log(`\nDeduplication complete -> Before: ${res.countBefore}, After: ${res.countAfter}, Removed: ${res.removed}\n`);
  }

  private static async clearLinks(): Promise<void> {
    const confirmClear = await confirm({
      message: 'Are you sure you want to remove ALL PR links from registry?',
      default: false
    });

    if (confirmClear) {
      PRRegistry.clear();
      console.log('✅ PR Registry cleared.\n');
    }
  }
}
