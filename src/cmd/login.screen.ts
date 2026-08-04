import { input, password, select } from '@inquirer/prompts';
import { AuthService } from '../core/auth/auth.service.js';
import { AuthProgressRenderer } from './auth-progress.renderer.js';
import { RuntimeSession, runtimeSession } from '../core/auth/runtime-session.js';
import { AccountPolicy, ALLOWED_BITBUCKET_EMAIL } from '../core/auth/account-policy.js';
import { SessionStore } from '../core/auth/session.store.js';

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
      default: initialEmail || ALLOWED_BITBUCKET_EMAIL,
      validate: (val) => {
        if (!val || !val.includes('@')) return 'Please enter a valid email address.';
        const check = AccountPolicy.validateEmail(val);
        if (!check.allowed) return check.reason || 'Access denied.';
        return true;
      }
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

    return { email: AccountPolicy.normalizeEmail(email), repository: repository.trim(), token: token.trim() };
  }

  static async executeLoginFlow(initialEmail = '', initialRepo = ''): Promise<RuntimeSession | null> {
    const existing = SessionStore.loadValidSession();
    if (existing) {
      this.displayHeader();
      console.log('--------------------------------------------------------');
      console.log('📌 Active Session Detected:');
      console.log(`   Account   : ${existing.session.email}`);
      console.log(`   Repo      : ${existing.session.repository.workspace}/${existing.session.repository.repoSlug}`);
      console.log(`   TTL       : Valid for ${existing.remainingMinutes} minute(s) (30-min security limit)`);
      console.log('--------------------------------------------------------\n');

      const sessionChoice = await select({
        message: 'Active session found. Choose login option:',
        choices: [
          { name: `1. Continue with active session (${existing.session.email})`, value: 'use_existing' },
          { name: '2. Log in with new credentials / token', value: 'new_login' },
          { name: '3. Exit CLI', value: 'exit' }
        ]
      });

      if (sessionChoice === 'exit') {
        return null;
      }

      if (sessionChoice === 'use_existing') {
        runtimeSession.setSession(existing.session);
        console.log('\n[✓] Loaded active session.\n');
        return existing.session;
      }

      // If user chooses new_login, clear saved session and fall through
      SessionStore.clearSession();
    }

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
        SessionStore.saveSession(authResult.session);
        console.log('\n[✓] Session ready & saved locally (30-min security TTL).\n');
        return authResult.session;
      }

      // Display failure menu and recovery options
      console.log(`\nValidation failed: ${authResult.error}`);
      console.log(`Log: ${authResult.logFilePath}\n`);

      const action = await select({
        message: 'Actions:',
        choices: [
          { name: '1. Retry token', value: 'retry_token' },
          { name: '2. Edit repository', value: 'edit_repo' },
          { name: '3. Restart login', value: 'restart_login' },
          { name: '4. Exit CLI', value: 'exit' }
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
