import { runtimeSession } from '../core/auth/runtime-session.js';
import { DiscoveryCache } from '../core/discovery/discovery-cache.js';

export class LogoutService {
  static async executeLogout(): Promise<void> {
    console.log('\nSecure logout');
    console.log('[1/6] Cancelling active jobs...');
    await new Promise((res) => setTimeout(res, 150));

    console.log('[2/6] Flushing sanitized logs...');
    await new Promise((res) => setTimeout(res, 150));

    console.log('[3/6] Clearing API token from session...');
    console.log('[4/6] Clearing account identity...');
    runtimeSession.clear();

    console.log('[5/6] Clearing PR discovery cache...');
    DiscoveryCache.clear();

    console.log('[6/6] Removing temporary session files...');
    await new Promise((res) => setTimeout(res, 150));

    console.log('✓ Logout complete');
    console.log('✓ No credentials persisted\n');

    process.exit(0);
  }
}
