// Secret and PII redaction on inputs that leaked through in a review of real formats.
import assert from 'node:assert/strict';
import { SecretScanner } from '../src/core/privacy/secret.scanner.ts';
import { PIISanitizer } from '../src/core/privacy/pii.sanitizer.ts';

// [input, the part that must not survive]
const leaks: Array<[string, string]> = [
  ['"client_secret": "AbCdEfGhIjKlMnOp123"', 'AbCdEfGhIjKlMnOp123'],
  ['"access_token": "abcdefghijklmnop1234"', 'abcdefghijklmnop1234'],
  ['"apiKey": "abcdefghijklmnop1234"', 'abcdefghijklmnop1234'],
  ['API_KEY=abcdefghijklmnop1234', 'abcdefghijklmnop1234'],
  ['x-api-key: abcdefghijklmnop1234', 'abcdefghijklmnop1234'],
  ['aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', 'wJalrXUtnFEMI'],
  ['client_secret: "abcdefghijklmnop+qrstuv/wxyz=="', 'qrstuv'],
  ['postgresql://admin:S3cretPw@db.internal:5432/app', 'S3cretPw'],
  ['mongodb+srv://user:p4ssw0rd@cluster0.example.net/db', 'p4ssw0rd'],
  ['Password="my secret pw"', 'my secret pw'],
  ['DefaultEndpointsProtocol=https;AccountName=acct;AccountKey=abc123def456ghi789jkl012mno345==;EndpointSuffix=core.windows.net', 'abc123def456'],
  ['https://acct.blob.core.windows.net/c?sv=2022-11-02&sig=AbCdEf123456%2Bxyz%3D', 'AbCdEf123456'],
  ['github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz0123456789', 'abcdefghijklmnopqrstuvwxyz'],
  ['token = glpat-abcdefghijklmnop1234', 'glpat-abcdefghijklmnop1234'],
  ['OPENAI=sk-proj-abcdefghijklmnop1234567890', 'abcdefghijklmnop1234567890'],
  ['ANTHROPIC=sk-ant-api03-abcdefghijklmnop1234567890', 'abcdefghijklmnop1234567890'],
  // A diff hunk can hold only one end of a PEM block.
  ['+-----BEGIN PRIVATE KEY-----\n+MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n+abcdEFGH', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7'],
  ['+MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7\n+-----END PRIVATE KEY-----', 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC7']
];
for (const [input, secret] of leaks) {
  const out = SecretScanner.scanAndRedact(input);
  assert.ok(!out.includes(secret), `leaked "${secret}" from: ${input}\n→ ${out}`);
}
console.log(`  ✓ ${leaks.length} secret formats are redacted`);

// Ordinary code keeps its meaning.
for (const code of [
  'await repo.SaveAsync(order, cancellationToken);',
  'public string ApiKey { get; set; }',
  'const header = "X-Api-Key";',
  'var url = "https://example.com/api/v1/items";',
  '-----END CERTIFICATE-----'
]) assert.equal(SecretScanner.scanAndRedact(code), code);
console.log('  ✓ ordinary code is left alone');

// HTML: real tags and comments go, generics and comparisons stay (they were eaten as "tags").
assert.equal(PIISanitizer.sanitizeText('Use List<string> when a < b && c > d'), 'Use List<string> when a < b && c > d');
assert.equal(PIISanitizer.sanitizeText('<p>Fix <b>bug</b></p><!-- template: fill me -->'), 'Fix bug');
console.log('  ✓ only HTML markup is stripped from text, not generics or comparisons');

// Key material is dropped once its 60 s window ends, not kept in memory until the process exits.
const { AccessGate } = await import('../src/core/auth/access-gate.ts');
AccessGate.setMaterial('acme', 'ttl', '{00000000-0000-0000-0000-00000000aaaa}');
const realNow = Date.now;
Date.now = () => realNow() + 61_000;
assert.throws(() => AccessGate.material('acme', 'ttl'), /No access/);
Date.now = realNow;
assert.equal((AccessGate as any).unlocked.size, 0, 'expired material is deleted');
console.log('  ✓ expired repository key material is removed from memory');
