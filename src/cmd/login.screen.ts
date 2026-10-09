import { AuthService } from '../core/auth/auth.service.js';
import { AuthProgressRenderer } from './auth-progress.renderer.js';
import { RuntimeSession } from '../core/auth/runtime-session.js';
import { AccountPolicy } from '../core/auth/account-policy.js';
import { ConfigManager } from '../config/config.manager.js';

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
    console.log('  ✓ Pull requests: Read  Scope: read:pullrequest:bitbucket');
    console.log('  ✓ Repositories: Read   Scope: read:repository:bitbucket');
    console.log('  ✗ Do NOT grant Write, Admin or Delete scopes.\n');
  }

  /**
   * Authenticates with the credentials from .env (BITBUCKET_EMAIL, BITBUCKET_API_TOKEN,
   * BITBUCKET_REPOSITORY). Never prompts; on failure prints what to fix in .env.
   */
  static async executeLoginFlow(): Promise<RuntimeSession | null> {
    this.displayHeader();
    const { email, token, repository } = ConfigManager.credentials();

    const missing = [
      !email && 'BITBUCKET_EMAIL',
      !token && 'BITBUCKET_API_TOKEN',
      !repository && 'BITBUCKET_REPOSITORY'
    ].filter(Boolean);
    if (missing.length > 0) {
      console.error(`Missing configuration in .env: ${missing.join(', ')}`);
      return null;
    }

    console.log(`Account    : ${email}`);
    console.log(`Repository : ${repository}`);
    AuthProgressRenderer.renderInitial();

    const authResult = await AuthService.authenticateAndProbe(
      AccountPolicy.normalizeEmail(email),
      repository,
      token,
      (stage) => AuthProgressRenderer.renderStage(stage)
    );

    if (authResult.success && authResult.session) {
      console.log('\n[✓] Authenticated.\n');
      return authResult.session;
    }

    console.error(`\nAuthentication failed: ${authResult.error}`);
    console.error('Fix BITBUCKET_EMAIL / BITBUCKET_API_TOKEN / BITBUCKET_REPOSITORY in .env and run again.');
    this.displayScopeBanner();
    console.error(`Log: ${authResult.logFilePath}\n`);
    return null;
  }
}
