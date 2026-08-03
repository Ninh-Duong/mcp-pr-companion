import { select, input, confirm } from '@inquirer/prompts';
import { PRRegistry } from '../core/registry/pr.registry.js';
import { ConfigManager } from '../config/config.manager.js';

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
    const mode = await select({
      message: '➕ Choose PR Entry Mode:',
      choices: [
        { name: '1. Dynamic Step-by-Step (Repo Slug + PR ID)', value: 'dynamic' },
        { name: '2. Paste Full Bitbucket PR URL', value: 'full_url' }
      ]
    });

    let targetUrl = '';

    if (mode === 'dynamic') {
      const baseConfig = ConfigManager.loadBase();
      let workspace = baseConfig.workspace;

      if (!workspace) {
        workspace = await input({
          message: 'Enter Bitbucket Workspace Slug (e.g. "siliconstack"):',
          validate: (val) => val && val.trim() ? true : '❌ Workspace Slug không được để trống!'
        });
        workspace = ConfigManager.sanitizeWorkspaceSlug(workspace).slug;
      }

      console.log(`\n🏢 Active Workspace: "${workspace}"`);

      const repoSlug = await input({
        message: 'Enter Repository Name / Slug (e.g. "wec.be"):',
        validate: (val) => {
          if (!val || !val.trim()) return '❌ Repository Slug không được để trống!';
          if (!/^[a-zA-Z0-9_\-\.]+$/.test(val.trim())) {
            return '❌ Tên repo chỉ được chứa chữ cái, chữ số, dấu gạch ngang (-), gạch dưới (_) hoặc dấu chấm (.)';
          }
          return true;
        }
      });

      const prIdStr = await input({
        message: 'Enter PR ID number (e.g. 4565):',
        validate: (val) => {
          const num = parseInt(val.trim().replace(/^#/, ''), 10);
          if (isNaN(num) || num <= 0) return '❌ PR ID phải là số nguyên dương (ví dụ: 4565)';
          return true;
        }
      });

      targetUrl = PRRegistry.buildPRUrl(workspace, repoSlug, prIdStr);
      console.log(`\n🔗 Dynamic Mapping generated PR URL: ${targetUrl}`);
    } else {
      targetUrl = await input({
        message: 'Enter Full Bitbucket PR URL (e.g. "https://bitbucket.org/siliconstack/wec.be/pull-requests/4565"):',
        validate: (val) => {
          if (!val || !val.trim()) {
            return '❌ Vui lòng nhập link PR URL!';
          }
          try {
            PRRegistry.parseAndValidateUrl(val.trim());
            return true;
          } catch (err: any) {
            return `❌ [SAI FORMAT] ${err.message}\n👉 Ví dụ chuẩn: https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`;
          }
        }
      });
    }

    if (!targetUrl || !targetUrl.trim()) return;

    try {
      const res = PRRegistry.add(targetUrl.trim());
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
