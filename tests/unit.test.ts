import { Redactor } from '../src/utils/redactor.js';
import { PRRegistry } from '../src/core/registry/pr.registry.js';
import { CapabilityGuard } from '../src/config/capability.guard.js';
import { ConfigManager } from '../src/config/config.manager.js';
import { CacheIndex } from '../src/core/storage/cache.index.js';
import { DataStore } from '../src/core/storage/data.store.js';

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

async function runTests() {
  console.log('\n================================================================');
  console.log('                 Running Unit & Integration Tests               ');
  console.log('================================================================\n');

  // 1. Redactor Tests
  console.log('1. Redactor & Secret Masking:');
  const token = 'ATBB1234567890abcdef';
  const masked = Redactor.maskToken(token);
  assert(masked === 'ATBB****cdef', 'Redactor.maskToken masks token with ATBB****suffix format');

  const rawLog = `Connecting with Authorization: Basic dXNlcjp0b2tlbg== and token "token": "${token}"`;
  const redacted = Redactor.redact(rawLog);
  assert(!redacted.includes(token) || redacted.includes('ATBB****cdef'), 'Redactor sanitizes tokens from log text');
  assert(redacted.includes('[REDACTED]'), 'Redactor sanitizes Authorization headers and JSON token keys');

  // 2. PRRegistry Tests
  console.log('\n2. PRRegistry & URL Canonicalization:');
  const validUrl = 'https://bitbucket.org/myworkspace/myrepo/pull-requests/4158';
  const parsed = PRRegistry.parseAndValidateUrl(validUrl);
  assert(parsed.workspace === 'myworkspace' && parsed.repoSlug === 'myrepo' && parsed.prId === 4158, 'parseAndValidateUrl extracts workspace, repo, and prId');
  assert(parsed.canonicalUrl === 'https://bitbucket.org/myworkspace/myrepo/pull-requests/4158', 'parseAndValidateUrl produces canonicalized HTTPS URL');

  const dotRepoUrl = 'https://bitbucket.org/siliconstack/wec.be/pull-requests/4565';
  const dotParsed = PRRegistry.parseAndValidateUrl(dotRepoUrl);
  assert(dotParsed.repoSlug === 'wec.be' && dotParsed.prId === 4565, 'parseAndValidateUrl accepts repository names containing dots (wec.be)');

  const dynamicBuilt = PRRegistry.buildPRUrl('siliconstack', 'wec.be', 4565);
  assert(dynamicBuilt === 'https://bitbucket.org/siliconstack/wec.be/pull-requests/4565', 'buildPRUrl dynamically constructs canonical URL from Workspace, Repo, and PR ID');

  let invalidThrown = false;
  try {
    PRRegistry.parseAndValidateUrl('http://bitbucket.org/ws/repo/pull-requests/123');
  } catch {
    invalidThrown = true;
  }
  assert(invalidThrown, 'parseAndValidateUrl rejects insecure http:// protocol');

  let traversalThrown = false;
  try {
    PRRegistry.parseAndValidateUrl('https://bitbucket.org/../etc/passwd/pull-requests/1');
  } catch {
    traversalThrown = true;
  }
  assert(traversalThrown, 'parseAndValidateUrl rejects path traversal attempts');

  // 3. CapabilityGuard Tests
  console.log('\n3. CapabilityGuard Security Checks:');
  const readProf = { auth: { type: 'api_token' as const, email_env: '', token_env: '' }, capabilities: ['pr.read', 'repository.read'] };
  assert(CapabilityGuard.checkReadAccess(readProf, 'pr.read'), 'CapabilityGuard allows pr.read for valid read profile');

  const disabledWriteProf = { enabled: false, auth: { type: 'api_token' as const, email_env: '', token_env: '' }, allow: ['pr.comment'], deny: ['pr.approve'], require_confirmation: true };
  const writeRes = CapabilityGuard.canExecuteWrite(disabledWriteProf, 'pr.comment');
  assert(!writeRes.allowed, 'CapabilityGuard blocks write actions when WriteProfile is disabled');

  // 4. ConfigManager Tests
  console.log('\n4. ConfigManager Profile Isolation & Sanitization:');
  const base = ConfigManager.loadBase();
  assert(base.schema_version === 2, 'ConfigManager loads BaseConfig with schema_version 2');
  assert(base.sync.concurrency >= 1, 'ConfigManager loads sync concurrency setting');

  const s1 = ConfigManager.sanitizeWorkspaceSlug('https://bitbucket.org/siliconstack/wec.be/pull-requests/4565');
  assert(s1.slug === 'siliconstack' && s1.extractedFromUrl, 'sanitizeWorkspaceSlug extracts slug from full Bitbucket PR URL');

  const s2 = ConfigManager.sanitizeWorkspaceSlug('  siliconstack  ');
  assert(s2.slug === 'siliconstack' && !s2.extractedFromUrl, 'sanitizeWorkspaceSlug cleans whitespace from plain slug');

  // 5. CacheIndex & DataStore Tests
  console.log('\n5. DataStore & CacheIndex Keys:');
  const key1 = CacheIndex.generateCacheKey('ws', 'repo', 100, 'abc123', 'def456', base);
  const key2 = CacheIndex.generateCacheKey('ws', 'repo', 100, 'abc123', 'def456', base);
  assert(key1 === key2, 'generateCacheKey produces deterministic cache key');
  assert(key1.startsWith('bitbucket:ws:repo:100:abc123:def456:v2:'), 'generateCacheKey incorporates provider, workspace, repo, PR ID, and commit hashes');

  console.log('\n================================================================');
  console.log(`Test Results: ${passed} Passed | ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
