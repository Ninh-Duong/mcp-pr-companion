import { select, checkbox, confirm } from '@inquirer/prompts';
import { PRRegistry } from '../core/registry/pr.registry.js';
import { SyncManager } from '../core/sync/sync.manager.js';
import { ProgressRenderer } from './progress.renderer.js';

export class SyncMenu {
  static async show(): Promise<void> {
    let running = true;
    while (running) {
      const choice = await select({
        message: '🔄 Generate & Export PR Data Menu',
        choices: [
          { name: '1. Export All PRs to /output', value: 'sync_all' },
          { name: '2. Select PRs to Export to /output', value: 'sync_select' },
          { name: '3. Show Last Export Summary', value: 'summary' },
          { name: '4. Back to Main Menu', value: 'back' }
        ]
      });

      switch (choice) {
        case 'sync_all':
          await this.runSync(PRRegistry.list(), true);
          break;
        case 'sync_select':
          await this.syncSelected();
          break;
        case 'summary':
          this.showSummary();
          break;
        case 'back':
          running = false;
          break;
      }
    }
  }

  private static async syncSelected(): Promise<void> {
    const items = PRRegistry.list();
    if (items.length === 0) {
      console.log('\n(PR registry is empty)\n');
      return;
    }

    const selectedUrls = await checkbox({
      message: 'Select PRs to sync:',
      choices: items.map(url => ({ name: url, value: url }))
    });

    if (selectedUrls.length > 0) {
      await this.runSync(selectedUrls, false);
    }
  }

  private static async runForceRefresh(): Promise<void> {
    const confirmed = await confirm({
      message: 'Force refresh will bypass commit-hash cache checks and re-download diffs for ALL PRs. Proceed?',
      default: false
    });

    if (confirmed) {
      await this.runSync(PRRegistry.list(), true);
    }
  }

  private static async runSync(urls: string[], forceRefresh: boolean): Promise<void> {
    if (urls.length === 0) {
      console.log('\n(No PR links specified to sync)\n');
      return;
    }

    console.log(`\n🚀 Starting Sync for ${urls.length} PRs... Press Ctrl+C at any time to cancel cleanly.\n`);

    const renderer = new ProgressRenderer();
    const controller = new AbortController();

    const onSigInt = () => {
      console.log('\n⚠️ Cancellation signal received! Cleaning up active sync jobs...');
      controller.abort();
    };

    process.on('SIGINT', onSigInt);

    try {
      const summary = await SyncManager.syncSelected(urls, {
        forceRefresh,
        signal: controller.signal,
        onProgress: (ev) => renderer.update(ev)
      });

      console.log('\n================================================================');
      console.log(`✅ Sync Completed! [Run ID: ${summary.runId}]`);
      console.log(`   Total: ${summary.total} | Succeeded: ${summary.succeeded} | Cached: ${summary.cached} | Failed: ${summary.failed} | Cancelled: ${summary.cancelled}`);
      console.log('================================================================\n');
    } catch (err: any) {
      console.log(`\n❌ Sync encountered an error: ${err.message || String(err)}\n`);
    } finally {
      process.off('SIGINT', onSigInt);
    }
  }

  private static showSummary(): void {
    const summary = SyncManager.getLatestSummary();
    if (!summary) {
      console.log('\n(No sync run summary found)\n');
      return;
    }

    console.log('\n================================================================');
    console.log(`📊 Latest Sync Run Summary [Run ID: ${summary.runId}]`);
    console.log(`   Started: ${summary.startedAt}`);
    console.log(`   Finished: ${summary.finishedAt}`);
    console.log(`   Total: ${summary.total} | Succeeded: ${summary.succeeded} | Cached: ${summary.cached} | Failed: ${summary.failed}`);
    console.log('----------------------------------------------------------------');
    summary.items.forEach(item => {
      const statusIcon = item.status === 'complete' || item.status === 'cached' ? '✓' : '✗';
      console.log(`   ${statusIcon} [${item.status.toUpperCase()}] ${item.ticketId || item.url}`);
      if (item.error) {
        console.log(`      Error: ${item.error}`);
      }
    });
    console.log('================================================================\n');
  }
}
