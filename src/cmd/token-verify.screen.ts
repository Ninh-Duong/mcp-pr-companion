import { select, password } from '@inquirer/prompts';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { CapabilityProbe } from '../core/auth/capability.probe.js';
import { SessionStore } from '../core/auth/session.store.js';

export type TokenVerifyResult = 'valid' | 'cancelled' | 'failed';

export class TokenVerifyScreen {
  static displayScopeNotice(): void {
    console.clear();
    console.log('========================================================');
    console.log('            PR DATA GENERATION TOKEN SCOPE              ');
    console.log('========================================================');
    console.log('\nRequired Bitbucket API Token Read Permissions:');
    console.log('  ✓ User: Read          Scope: read:user:bitbucket');
    console.log('    Used to identify current account identity.');
    console.log('  ✓ Repositories: Read   Scope: read:repository:bitbucket');
    console.log('    Used to download PR diff, commit list and source.');
    console.log('  ✓ Pull requests: Read Scope: read:pullrequest:bitbucket');
    console.log('    Used to read pull-request metadata and diffstat.');
    console.log('\n  Strictly Read-Only Notice:');
    console.log('  ✗ NO Write, Admin, or Delete permissions are required.\n');
  }

  static async verifyOrUpdateToken(): Promise<TokenVerifyResult> {
    this.displayScopeNotice();

    const session = runtimeSession.getSession();
    if (!session) return 'failed';

    // Test capability with active session token
    const probe = await CapabilityProbe.executeProbes(
      session.email,
      session.token,
      session.repository.workspace,
      session.repository.repoSlug
    );

    if (probe.success) {
      console.log('[✓] Active session token verified with required read permissions.\n');
      return 'valid';
    }

    console.log(`[✗] Active session token failed verification: ${probe.failedStage?.message || 'Missing required scopes'}\n`);
    
    const choice = await select<'update' | 'cancel'>({
      message: 'Would you like to enter an API Token with full read permissions for data generation?',
      choices: [
        { name: '1. Enter new API Token', value: 'update' },
        { name: '2. ⬅️ Cancel and return to Generate menu', value: 'cancel' }
      ]
    });

    if (choice === 'cancel') {
      return 'cancelled';
    }

    const newToken = await password({
      message: 'Enter Bitbucket API Token:',
      mask: '*',
      validate: (val) => (val && val.trim().length > 0 ? true : 'Token cannot be empty.')
    });

    // Re-verify new token
    const reProbe = await CapabilityProbe.executeProbes(
      session.email,
      newToken.trim(),
      session.repository.workspace,
      session.repository.repoSlug
    );

    if (reProbe.success) {
      session.token = newToken.trim();
      runtimeSession.setSession(session);
      SessionStore.saveSession(session);
      console.log('[✓] Token verified successfully and updated in session storage.\n');
      return 'valid';
    } else {
      console.log(`[✗] New token failed verification: ${reProbe.failedStage?.message}\n`);
      return 'failed';
    }
  }
}
