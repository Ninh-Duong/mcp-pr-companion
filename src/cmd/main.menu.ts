import { select } from '@inquirer/prompts';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { PRListScreen } from './pr-list.screen.js';
import { GenerateMenu } from './generate.menu.js';
import { LogoutService } from './logout.service.js';

export class MainMenu {
  static displayHeader(): void {
    console.clear();
    console.log(`================================================================`);
    console.log(`                     MCP PR Companion CLI                       `);
    console.log(`================================================================`);

    const session = runtimeSession.getSession();
    if (session) {
      console.log(` Logged in as : ${session.email}`);
      console.log(` Repository   : ${session.repository.workspace}/${session.repository.repoSlug}`);
    } else {
      console.log(` Status       : Not logged in`);
    }
    console.log(`----------------------------------------------------------------\n`);
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
        await PRListScreen.render();
      } else if (choice === 'generate_data') {
        await GenerateMenu.displayMenu();
      } else if (choice === 'logout') {
        await LogoutService.executeLogout();
      }
    }
  }
}
