import assert from 'assert';
import { GenerateAllService } from '../src/core/orchestration/generate-all.service.js';
import { ConfigManager } from '../src/config/config.manager.js';

async function runOrchestrationTests() {
  console.log('\n================================================================');
  console.log('       Running GenerateAllService & Orchestration Unit Tests    ');
  console.log('================================================================\n');

  // Test 1: Service definition and interface integrity
  console.log('1. GenerateAllService API availability:');
  assert(typeof GenerateAllService.execute === 'function', 'GenerateAllService.execute should be a static function');
  console.log('  ✓ GenerateAllService.execute interface exists');

  // Test 2: All configuration comes from environment variables (.env)
  console.log('\n2. ConfigManager reads credentials and settings from env:');
  Object.assign(process.env, {
    BITBUCKET_EMAIL: ' a.user@example.com ',
    BITBUCKET_API_TOKEN: 'test-token-secret-123',
    BITBUCKET_REPOSITORY: 'test-workspace/test-repo',
    ALLOWED_EMAILS: 'a.user@example.com, b.user@example.com',
    TICKET_PREFIXES: 'ABC-,XYZ-',
    PRIVACY_REMOVE_AUTHOR: 'false',
    PRIVACY_MAX_COMMIT_SUBJECTS: '5',
    PRIVACY_MODE: '',
    AI_CONTEXT_ROOT: 'out'
  });
  const creds = ConfigManager.credentials();
  assert.deepStrictEqual(creds, { email: 'a.user@example.com', token: 'test-token-secret-123', repository: 'test-workspace/test-repo' });
  const config = ConfigManager.loadBase();
  assert.deepStrictEqual(config.allowed_emails, ['a.user@example.com', 'b.user@example.com']);
  assert.deepStrictEqual(config.ticket_prefix, ['ABC-', 'XYZ-']);
  assert.strictEqual(config.privacy.remove_author, false);
  assert.strictEqual(config.privacy.max_commit_subjects, 5);
  assert.strictEqual(config.privacy.mode, 'strict', 'Empty env value falls back to default');
  assert.strictEqual(config.ai_context.root, 'out');
  assert.strictEqual(config.ai_context.company, 'siliconstack', 'Unset env value falls back to default');
  console.log('  ✓ Credentials, lists, booleans, numbers and defaults parse correctly');

  console.log('\n================================================================');
  console.log('       All Orchestration Unit Tests Passed Successfully!        ');
  console.log('================================================================\n');
}

runOrchestrationTests().catch((err) => {
  console.error('Orchestration Test Failure:', err);
  process.exit(1);
});
