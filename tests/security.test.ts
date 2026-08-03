import { SecretScanner } from '../src/core/privacy/secret.scanner.js';
import { PIISanitizer } from '../src/core/privacy/pii.sanitizer.js';
import { PathSanitizer } from '../src/core/privacy/path.sanitizer.js';
import { URLSanitizer } from '../src/core/privacy/url.sanitizer.js';
import { SensitiveFilePolicy } from '../src/core/analyzer/sensitive.file.policy.js';
import { OpaqueIDGenerator } from '../src/core/storage/opaque.id.js';
import { DataStore } from '../src/core/storage/data.store.js';
import { RedactionTracker } from '../src/core/privacy/redaction.report.js';

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

async function runSecurityTests() {
  console.log('\n================================================================');
  console.log('                 Running PR Security & Privacy Tests            ');
  console.log('================================================================\n');

  // 1. Secret Scanner Tests
  console.log('1. Secret Scanner Credential Redaction:');
  const tracker = new RedactionTracker();

  const bearerSample = 'Header Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
  const redactedBearer = SecretScanner.scanAndRedact(bearerSample, tracker);
  assert(!redactedBearer.includes('eyJhbGci') && redactedBearer.includes('[REDACTED:BEARER_TOKEN]'), 'Bearer token scanned and replaced with [REDACTED:BEARER_TOKEN]');

  const connStringSample = 'Server=myServerAddress;Database=myDataBase;User Id=myUsername;Password=myPassword123;';
  const redactedConn = SecretScanner.scanAndRedact(connStringSample, tracker);
  assert(!redactedConn.includes('myPassword123') && redactedConn.includes('[REDACTED:CONNECTION_STRING]'), 'Database Connection string scanned and replaced with [REDACTED:CONNECTION_STRING]');

  const awsSample = 'AWS_ACCESS_KEY_ID = AKIAIOSFODNN7EXAMPLE';
  const redactedAWS = SecretScanner.scanAndRedact(awsSample, tracker);
  assert(!redactedAWS.includes('AKIAIOSFODNN7EXAMPLE') && redactedAWS.includes('[REDACTED:AWS_KEY]'), 'AWS Access Key scanned and replaced with [REDACTED:AWS_KEY]');

  const privKeySample = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA0Z3\n-----END RSA PRIVATE KEY-----';
  const redactedKey = SecretScanner.scanAndRedact(privKeySample, tracker);
  assert(!redactedKey.includes('MIIEowIBAAKCAQEA0Z3') && redactedKey.includes('[REDACTED:PRIVATE_KEY]'), 'RSA Private Key scanned and replaced with [REDACTED:PRIVATE_KEY]');

  // 2. PII Sanitizer Tests
  console.log('\n2. PII Sanitizer & Author Anonymization:');
  const piiText = 'Contact author at john.doe@company.com or uuid {12345678-1234-1234-1234-1234567890ab}';
  const sanitizedText = PIISanitizer.sanitizeText(piiText, tracker);
  assert(!sanitizedText.includes('john.doe@company.com') && sanitizedText.includes('[REDACTED:EMAIL]'), 'Email address replaced with [REDACTED:EMAIL]');
  assert(!sanitizedText.includes('{12345678-1234-1234-1234-1234567890ab}') && sanitizedText.includes('[REDACTED:UUID]'), 'UUID replaced with [REDACTED:UUID]');

  const authorObj = { display_name: 'John Doe', raw: 'John Doe <john@company.com>', account_id: '557058:12345678-1234' };
  const removedAuthor = PIISanitizer.sanitizeAuthor(authorObj, true, tracker);
  assert(removedAuthor === null, 'Author metadata completely removed when remove_author is true');

  // 3. Path Sanitizer & URL Sanitizer
  console.log('\n3. Path & URL Sanitizers:');
  const fullPath = 'src/Backend/Services/User/Controllers/UserController.cs';
  const sanitizedPath = PathSanitizer.sanitize(fullPath, 'sanitized');
  assert(sanitizedPath === 'src/.../Controllers/UserController.cs', 'PathSanitizer replaces intermediate path segments with ...');

  const basenamePath = PathSanitizer.sanitize(fullPath, 'basename');
  assert(basenamePath === 'UserController.cs', 'PathSanitizer basename mode extracts file basename');

  const approveUrl = 'https://bitbucket.org/workspace/repo/pull-requests/123/approve';
  const sanitizedUrl = URLSanitizer.sanitize(approveUrl);
  assert(sanitizedUrl === '[REDACTED:PROVIDER_ENDPOINT]', 'URLSanitizer redacts provider approve/merge write endpoints');

  // 4. Sensitive File Policy Tests
  console.log('\n4. Sensitive File Policy:');
  assert(SensitiveFilePolicy.isSensitiveFile('.env'), 'SensitiveFilePolicy identifies .env file');
  assert(SensitiveFilePolicy.isSensitiveFile('.env.production'), 'SensitiveFilePolicy identifies .env.production file');
  assert(SensitiveFilePolicy.isSensitiveFile('appsettings.Development.json'), 'SensitiveFilePolicy identifies appsettings.Development.json');
  assert(SensitiveFilePolicy.isSensitiveFile('server.key'), 'SensitiveFilePolicy identifies server.key');
  assert(!SensitiveFilePolicy.isSensitiveFile('UserController.cs'), 'SensitiveFilePolicy accepts normal code files');

  // 5. Opaque ID Generator Tests
  console.log('\n5. Opaque Repository & Revision IDs:');
  const repoId1 = OpaqueIDGenerator.getRepositoryID('myworkspace', 'myrepo');
  const repoId2 = OpaqueIDGenerator.getRepositoryID('myworkspace', 'myrepo');
  assert(repoId1 === repoId2, 'OpaqueIDGenerator produces deterministic repo_xxx ID');
  assert(repoId1.startsWith('repo_'), 'OpaqueIDGenerator prefixes repo ID with repo_');
  assert(!repoId1.includes('myworkspace') && !repoId1.includes('myrepo'), 'OpaqueIDGenerator masks workspace and repoSlug names');

  const revId1 = OpaqueIDGenerator.getRevisionID('abc123hash', 'def456hash');
  assert(revId1.startsWith('rev_'), 'OpaqueIDGenerator produces rev_xxx revision ID');

  console.log('\n================================================================');
  console.log(`Security Test Results: ${passed} Passed | ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests();
