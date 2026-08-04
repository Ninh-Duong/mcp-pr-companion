import assert from 'assert';
import { GenerateAllService } from '../src/core/orchestration/generate-all.service.js';
import { RuntimeSession } from '../src/core/auth/runtime-session.js';
import { SessionStore } from '../src/core/auth/session.store.js';

async function runOrchestrationTests() {
  console.log('\n================================================================');
  console.log('       Running GenerateAllService & Orchestration Unit Tests    ');
  console.log('================================================================\n');

  // Test 1: Service definition and interface integrity
  console.log('1. GenerateAllService API availability:');
  assert(typeof GenerateAllService.execute === 'function', 'GenerateAllService.execute should be a static function');
  console.log('  ✓ GenerateAllService.execute interface exists');

  // Test 2: Token persistence verification
  console.log('\n2. SessionStore token persistence verification:');
  const mockSession: RuntimeSession = {
    email: 'ninh.duong@siliconstack.com.au',
    token: 'test-token-secret-123',
    currentUserUuid: '{test-uuid-001}',
    displayName: 'Ninh Duong',
    repository: {
      workspace: 'test-workspace',
      repoSlug: 'test-repo',
      opaqueId: 'test-workspace/test-repo'
    },
    capabilities: {
      tokenAuthenticated: true,
      userAccess: true,
      repoRead: true,
      prRead: true,
      diffRead: true
    }
  };

  SessionStore.saveSession(mockSession);
  const loaded = SessionStore.loadValidSession();
  assert(loaded !== null, 'Saved session should be loadable');
  assert.strictEqual(loaded?.session.token, 'test-token-secret-123', 'Saved token matches');
  assert.strictEqual(loaded?.session.currentUserUuid, 'test-uuid-001', 'Saved currentUserUuid is normalized');

  // Clean up test session
  SessionStore.clearSession();
  assert(SessionStore.loadValidSession() === null, 'Cleared session is removed');
  console.log('  ✓ SessionStore correctly saves and clears updated tokens');

  console.log('\n================================================================');
  console.log('       All Orchestration Unit Tests Passed Successfully!        ');
  console.log('================================================================\n');
}

runOrchestrationTests().catch((err) => {
  console.error('Orchestration Test Failure:', err);
  process.exit(1);
});
