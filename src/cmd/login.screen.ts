import { input, password } from '@inquirer/prompts';
import { AuthService } from '../core/auth/auth.service.js';
import { AuthProgressRenderer } from './auth-progress.renderer.js';
import { RuntimeSession } from '../core/auth/runtime-session.js';

export interface LoginPromptResult {
  email: string;
  repository: string;
  token: string;
}

export class LoginScreen {
  static displayHeader(): void {
    console.clear();
    console.log('========================================================');
    console.log('                  MCP PR COMPANION                      ');
    console.log('========================================================\n');
  }

  static displayScopeBanner(): void {
    console.log('\nRequired Bitbucket API token permissions:');
    console.log('  ✓ User: Read           Scope: read:user:bitbucket');
    console.log('    Used to identify the authenticated Bitbucket account.');
    console.log('  ✓ Pull requests: Read  Scope: read:pullrequest:bitbucket');
    console.log('    Used to list and read your pull requests.');
    console.log('  ✓ Repositories: Read    Scope: read:repository:bitbucket');
    console.log('    Used to read diff, commits and repository source.');
    console.log('\n  Do NOT grant:');
    console.log('  ✗ Repository Write');
    console.log('  ✗ Pull Request Write');
    console.log('  ✗ Admin');
    console.log('  ✗ Delete\n');
  }

  static async promptCredentials(initialEmail = '', initialRepo = ''): Promise<LoginPromptResult> {
    this.displayHeader();

    const email = await input({
      message: 'Atlassian email:',
      default: initialEmail || undefined,
      validate: (val) => (val && val.includes('@') ? true : 'Please enter a valid email address.')
    });

    const repository = await input({
      message: 'Repository (workspace/repo):',
      default: initialRepo || undefined,
      validate: (val) => {
        const parsed = AuthService.parseRepositoryInput(val);
        if (!parsed.valid) {
          if (parsed.suggestion) {
            return `${parsed.error} ${parsed.suggestion}`;
          }
          return parsed.error || 'Invalid repository format.';
        }
        return true;
      }
    });

    this.displayScopeBanner();

    const token = await password({
      message: 'API Token:',
      mask: '*',
      validate: (val) => (val && val.trim().length > 0 ? true : 'API Token cannot be empty.')
    });

    return { email: email.trim(), repository: repository.trim(), token: token.trim() };
  }

  static async executeLoginFlow(initialEmail = '', initialRepo = ''): Promise<RuntimeSession | null> {
    let credentials = await this.promptCredentials(initialEmail, initialRepo);

    while (true) {
      AuthProgressRenderer.renderInitial();

      const authResult = await AuthService.authenticateAndProbe(
        credentials.email,
        credentials.repository,
        credentials.token,
        (stageName, success, message) => {
          AuthProgressRenderer.renderStage({
            stageIndex: 0,
            stageName,
            success,
            message
          });
        }
      );

      if (authResult.success && authResult.session) {
        console.log('\n[✓] Session ready.\n');
        return authResult.session;
      }

      // Display failure menu and recovery options
      console.log(`\nValidation failed: ${authResult.error}`);
      console.log(`Log: ${authResult.logFilePath}\n`);

      const { select } = await import('@inquirer/prompts');
      const action = await select({
        message: 'Actions:',
        choices: [
          { name: '1. Retry token', value: 'retry_token' },
          { name: '2. Edit repository', value: 'edit_repo' },
          { name: '3. Restart login', value: 'restart_login' },
          { name: '4. Exit', value: 'exit' }
        ]
      });

      if (action === 'exit') {
        return null;
      }

      if (action === 'retry_token') {
        this.displayScopeBanner();
        const newToken = await password({
          message: 'API Token:',
          mask: '*',
          validate: (val) => (val && val.trim().length > 0 ? true : 'API Token cannot be empty.')
        });
        credentials.token = newToken.trim();
      } else if (action === 'edit_repo') {
        const newRepo = await input({
          message: 'Repository (workspace/repo):',
          default: credentials.repository,
          validate: (val) => {
            const parsed = AuthService.parseRepositoryInput(val);
            if (!parsed.valid) {
              if (parsed.suggestion) {
                return `${parsed.error} ${parsed.suggestion}`;
              }
              return parsed.error || 'Invalid repository format.';
            }
            return true;
          }
        });
        credentials.repository = newRepo.trim();
      } else if (action === 'restart_login') {
        credentials = await this.promptCredentials();
      }
    }
  }
}
