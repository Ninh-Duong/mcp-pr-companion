import { runtimeSession } from '../core/auth/runtime-session.js';
import { CapabilityProbe } from '../core/auth/capability.probe.js';

export type TokenVerifyResult = 'valid' | 'failed';

export class TokenVerifyScreen {
  static displayScopeNotice(): void {
    console.clear();
    console.log('========================================================');
    console.log('            PR DATA GENERATION TOKEN SCOPE              ');
    console.log('========================================================');
    console.log('\nRequired Bitbucket API Token Read Permissions:');
    console.log('  ✓ User: Read          Scope: read:user:bitbucket');
    console.log('  ✓ Repositories: Read   Scope: read:repository:bitbucket');
    console.log('  ✓ Pull requests: Read Scope: read:pullrequest:bitbucket');
    console.log('  ✗ NO Write, Admin, or Delete permissions are required.\n');
  }

  static async verifyOrUpdateToken(): Promise<TokenVerifyResult> {
    this.displayScopeNotice();

    const session = runtimeSession.getSession();
    if (!session) return 'failed';

    const probe = await CapabilityProbe.executeProbes(
      session.email,
      session.token,
      session.repository.workspace,
      session.repository.repoSlug
    );

    if (probe.success) {
      console.log('[✓] API token verified with required read permissions.\n');
      return 'valid';
    }

    console.log(`[✗] API token failed verification: ${probe.failedStage?.message || 'Missing required scopes'}`);
    console.log('Fix BITBUCKET_API_TOKEN in .env (read-only scopes above) and run again.\n');
    return 'failed';
  }
}
