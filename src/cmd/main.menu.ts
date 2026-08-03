import { select } from '@inquirer/prompts';
import { ConfigMenu } from './config.menu.js';
import { PRListMenu } from './pr-list.menu.js';
import { SyncMenu } from './sync.menu.js';
import { ConfigManager } from '../config/config.manager.js';
import { PRRegistry } from '../core/registry/pr.registry.js';
import { DataStore } from '../core/storage/data.store.js';

export class MainMenu {
  static async start(): Promise<void> {
    const migration = ConfigManager.checkLegacyMigration();
    if (migration.hasLegacy && migration.warning) {
      console.log(`\n${migration.warning}\n`);
    }

    let running = true;
    while (running) {
      const choice = await select({
        message: '🤖 MCP PR Companion Terminal UI',
        choices: [
          { name: '1. Configuration Settings', value: 'config' },
          { name: '2. Manage PR Link Registry', value: 'prs' },
          { name: '3. Sync PR Data (Warm Local Cache)', value: 'sync' },
          { name: '4. Browse Local Cached PR Data', value: 'browse' },
          { name: '5. View Sync Logs Summary', value: 'logs' },
          { name: '6. Exit', value: 'exit' }
        ]
      });

      switch (choice) {
        case 'config':
          await ConfigMenu.show();
          break;
        case 'prs':
          await PRListMenu.show();
          break;
        case 'sync':
          await SyncMenu.show();
          break;
        case 'browse':
          this.browseData();
          break;
        case 'logs':
          SyncMenu['showSummary']();
          break;
        case 'exit':
          console.log('Goodbye! 👋');
          running = false;
          break;
      }
    }
  }

  private static browseData(): void {
    const links = PRRegistry.list();
    console.log(`\nLocal PR Cache Inspection (${links.length} registered links):`);
    links.forEach(link => {
      try {
        const parsed = PRRegistry.parseAndValidateUrl(link);
        const active = DataStore.getActiveRevision(parsed.workspace, parsed.repoSlug, parsed.prId);
        if (active && active.manifest) {
          console.log(`  ✓ ${parsed.workspace}/${parsed.repoSlug} #${parsed.prId} [Ticket: ${active.manifest.pr.ticket_id || 'N/A'}]`);
          console.log(`    Title: "${active.manifest.pr.title}"`);
          console.log(`    Files: ${active.manifest.stats.files} (+${active.manifest.stats.additions}/-${active.manifest.stats.deletions})`);
          console.log(`    Source Hash: ${active.manifest.pr.source_hash.substring(0, 8)} | Checked: ${active.current.last_checked_at}`);
        } else {
          console.log(`  ✗ ${parsed.workspace}/${parsed.repoSlug} #${parsed.prId} (Not synced yet)`);
        }
      } catch {
        console.log(`  ? ${link}`);
      }
    });
    console.log();
  }
}
