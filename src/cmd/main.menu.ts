import { select } from '@inquirer/prompts';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { PRListScreen } from './pr-list.screen.js';
import { GenerateMenu } from './generate.menu.js';
import { ContextViewerScreen } from './context-viewer.screen.js';
import { LoginScreen } from './login.screen.js';
import { ConfigManager } from '../config/config.manager.js';

export class MainMenu {
  static displayHeader(): void {
    console.clear();
    console.log(`================================================================`);
    console.log(`                     MCP PR Companion CLI                       `);
    console.log(`================================================================`);

    const session = runtimeSession.getSession();
    if (session) {
      console.log(` Account      : ${session.email}`);
      console.log(` User UUID    : ${session.currentUserUuid}`);
      console.log(` Repository   : ${session.repository.workspace}/${session.repository.repoSlug}`);
    } else {
      console.log(` Status       : Not logged in`);
    }
    console.log(`----------------------------------------------------------------\n`);
  }

  static async displayMenu(): Promise<void> {
    while (true) {
      this.displayHeader();

      const choices = [
        { name: '1. View current pull requests', value: 'view_prs' },
        { name: '2. Generate PR data', value: 'generate_data' },
        { name: '3. View synced PR context (decrypted)', value: 'view_context' }
      ];
      if (ConfigManager.credentials().repositories.length > 1) {
        choices.push({ name: `${choices.length + 1}. Switch repository`, value: 'switch_repo' });
      }
      choices.push({ name: `${choices.length + 1}. Exit CLI`, value: 'exit' });

      const choice = await select({ message: 'Main Menu Options:', choices });

      if (choice === 'view_prs') {
        await PRListScreen.render();
      } else if (choice === 'generate_data') {
        await GenerateMenu.displayMenu();
      } else if (choice === 'view_context') {
        await ContextViewerScreen.render();
      } else if (choice === 'switch_repo') {
        // On failure the previous repository session stays active.
        if (!(await LoginScreen.executeLoginFlow())) {
          await new Promise(r => setTimeout(r, 3000));
        }
      } else if (choice === 'exit') {
        console.log('\nExiting MCP PR Companion. Goodbye!');
        process.exit(0);
      }
    }
  }
}
