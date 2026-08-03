import { select } from '@inquirer/prompts';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { DiscoveryCache } from '../core/discovery/discovery-cache.js';
import { PRListScreen } from './pr-list.screen.js';
import { GenerateMenu } from './generate.menu.js';
import { LogoutService } from './logout.service.js';

export class MainMenu {
  static displayHeader(): void {
    const session = runtimeSession.getSession();
    const openPrs = DiscoveryCache.getPRs().length;

    console.clear();
    console.log('========================================================');
    console.log('                  MCP PR COMPANION                      ');
    console.log(`Account:    Authenticated (${session?.displayName || 'User'})`);
    console.log(`Repository: ${session?.repository.opaqueId || 'N/A'}`);
    console.log(`Mode:       Read only`);
    console.log(`Open PRs:   ${openPrs}`);
    console.log('========================================================\n');
  }

  static async displayMenu(): Promise<void> {
    while (true) {
      this.displayHeader();

      const choice = await select({
        message: 'Main Menu:',
        choices: [
          { name: '1. View current pull requests', value: 'view_prs' },
          { name: '2. Generate PR data', value: 'generate_data' },
          { name: '3. Logout', value: 'logout' }
        ]
      });

      if (choice === 'view_prs') {
        await PRListScreen.displayMenu();
      } else if (choice === 'generate_data') {
        await GenerateMenu.displayMenu();
      } else if (choice === 'logout') {
        await LogoutService.executeLogout();
      }
    }
  }
}
