import { SecretScanner } from '../src/core/privacy/secret.scanner.js';
import { PIISanitizer } from '../src/core/privacy/pii.sanitizer.js';
import { PathSanitizer } from '../src/core/privacy/path.sanitizer.js';
import { URLSanitizer } from '../src/core/privacy/url.sanitizer.js';
import { SensitiveFilePolicy } from '../src/core/analyzer/sensitive.file.policy.js';
import { OpaqueIDGenerator } from '../src/core/storage/opaque.id.js';
import { DataStore } from '../src/core/storage/data.store.js';
import { RedactionTracker } from '../src/core/privacy/redaction.report.js';
import { Redactor } from '../src/utils/redactor.js';
import { LogRedactor } from '../src/core/logging/log.redactor.js';
import { OutputReader } from '../src/core/output/output.reader.js';
import { DiffParser } from '../src/core/analyzer/diff.parser.js';
import { PaginationHelper } from '../src/core/bitbucket/pagination.js';

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

  console.log('\n6. Atlassian API Token (ATATT) Redaction:');
  const atatt = 'ATATT3xFfGF0abcdefghijklmnop1234567890=ABCD1234';
  assert(!SecretScanner.scanAndRedact(`token used: ${atatt}`).includes('ATATT3x'), 'SecretScanner redacts ATATT API tokens');
  assert(!Redactor.redact(`err ${atatt}`).includes('abcdefghijklmnop'), 'Redactor masks ATATT API tokens');
  assert(!LogRedactor.redactString(`err ${atatt}`).includes('ATATT3x'), 'LogRedactor redacts ATATT API tokens');

  console.log('\n7. file_id Path Traversal Guard:');
  assert(OutputReader.normalizeFileId(12) === 'file_0012', 'Numeric file_id normalizes to file_0012');
  assert(OutputReader.normalizeFileId('file_0003') === 'file_0003', 'Canonical file_id passes through');
  let traversalRejected = false;
  try { OutputReader.normalizeFileId('../../../etc/passwd'); } catch { traversalRejected = true; }
  assert(traversalRejected, 'Traversal file_id is rejected');

  console.log('\n8. Diff Parser Header Lines Inside Hunks:');
  const trickyDiff = [
    'diff --git a/q.sql b/q.sql',
    '--- a/q.sql',
    '+++ b/q.sql',
    '@@ -1,2 +1,2 @@',
    '--- old sql comment',
    '+++ new sql comment',
    ' SELECT 1;'
  ].join('\n');
  const tf = DiffParser.parse(trickyDiff).files[0];
  assert(tf.oldPath === 'q.sql' && tf.newPath === 'q.sql', 'In-hunk "---"/"+++" lines do not overwrite file paths');
  assert(tf.additions === 1 && tf.deletions === 1, 'In-hunk "---"/"+++" lines count as deletion/addition');

  console.log('\n9. Pagination Refuses Cross-Origin next:');
  const realFetch = globalThis.fetch;
  const fetchedUrls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    fetchedUrls.push(String(url));
    return new Response(JSON.stringify({ values: [1], next: 'https://evil.example.com/steal' }), { status: 200 });
  }) as typeof fetch;
  const page = await PaginationHelper.fetchAllPages<number>('https://api.bitbucket.org/2.0/x', { Authorization: 'Bearer t' });
  globalThis.fetch = realFetch;
  assert(fetchedUrls.length === 1 && !page.isComplete, 'Pagination stops instead of following a foreign host');

  console.log('\n10. Extra Secret Patterns:');
  const extra = SecretScanner.scanAndRedact('gh=ghp_abcdefghijklmnopqrstuvwxyz0123456789AB bypass=keepme');
  assert(!extra.includes('ghp_abc'), 'SecretScanner redacts GitHub tokens');
  assert(extra.includes('bypass=keepme'), 'password pattern no longer matches inside "bypass"');

  console.log('\n================================================================');
  console.log(`Security Test Results: ${passed} Passed | ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSecurityTests();
