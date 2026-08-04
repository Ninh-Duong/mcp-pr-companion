import { SessionStore } from '../src/core/auth/session.store.js';
import { RuntimeSession } from '../src/core/auth/runtime-session.js';
import fs from 'fs';
import path from 'path';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failed++;
  }
}

async function runSessionStoreTests() {
  console.log('\n================================================================');
  console.log('            Running SessionStore & 30-Min TTL Unit Tests        ');
  console.log('================================================================\n');

  // Clean up any existing session file before starting
  SessionStore.clearSession();

  const mockSession: RuntimeSession = {
    email: 'ninh.duong@siliconstack.com.au',
    token: 'test_token_12345',
    currentUserUuid: '{12345678-1234-1234-1234-1234567890ab}',
    displayName: 'Ninh Duong',
    repository: {
      workspace: 'siliconstack',
      repoSlug: 'wec.be',
      opaqueId: 'workspace/repo'
    },
    capabilities: {
      tokenAuthenticated: true,
      userAccess: true,
      repoRead: true,
      prRead: true,
      diffRead: true
    }
  };

  // Test 1: Save & Load Valid Session
  console.log('1. Session Save & Load:');
  SessionStore.saveSession(mockSession);
  const loaded = SessionStore.loadValidSession();
  assert(loaded !== null, 'SessionStore loads valid persisted session');
  assert(loaded?.session.email === mockSession.email, 'Loaded session contains correct email');
  assert(loaded?.session.token === mockSession.token, 'Loaded session contains correct API token');
  assert(loaded?.remainingMinutes === 30, 'New session has 30 remaining minutes TTL');

  // Test 2: Expired Session (> 30 minutes)
  console.log('\n2. 30-Minute Security TTL Expiration:');
  const sessionFile = path.resolve(process.cwd(), '.mcp-pr-companion', 'session.json');
  assert(fs.existsSync(sessionFile), 'session.json exists on disk');

  // Artificially modify createdAt to 31 minutes ago
  const thirtyOneMinsAgo = Date.now() - (31 * 60 * 1000);
  const expiredData = { session: mockSession, createdAt: thirtyOneMinsAgo };
  fs.writeFileSync(sessionFile, JSON.stringify(expiredData), 'utf-8');

  const expiredAttempt = SessionStore.loadValidSession();
  assert(expiredAttempt === null, 'SessionStore rejects session older than 30 minutes');
  assert(!fs.existsSync(sessionFile), 'SessionStore automatically deletes expired session file from disk');

  // Test 3: Clear Session
  console.log('\n3. Explicit Session Cleanup:');
  SessionStore.saveSession(mockSession);
  assert(fs.existsSync(sessionFile), 'session.json recreated');
  SessionStore.clearSession();
  assert(!fs.existsSync(sessionFile), 'clearSession() purges session.json from disk');
  assert(SessionStore.loadValidSession() === null, 'loadValidSession() returns null after clearSession()');

  console.log('\n================================================================');
  console.log(`Test Results: ${passed} Passed | ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSessionStoreTests().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
