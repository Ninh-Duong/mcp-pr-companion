// PRC1 encrypted file format: round trip, sealed bytes, readable header, wrong key, tampering, truncation, plaintext.
import assert from 'node:assert/strict';
import fs from 'fs';
import { writeSecure, readSecure, readHeader, encryptText, decryptBuffer, PlaintextFileError } from '../src/core/storage/secure-file.ts';
import { AccessGate } from '../src/core/auth/access-gate.ts';
import { purgePlaintext } from '../src/core/storage/purge.ts';

const scope = { workspace: 'acme', repoSlug: 'demo', prId: 3 };
const UUID = '{aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee}';
const secret = 'Fix ConnectionString handling in BillingService — ticket WC-36';

// Locked: nothing can be written or read without an unlock.
assert.throws(() => encryptText(secret, scope), /No access: acme\/demo is locked/);

AccessGate.setMaterial('acme', 'demo', UUID);
fs.mkdirSync('ai-context/acme/demo/pr_3', { recursive: true });
const file = 'ai-context/acme/demo/pr_3/context.md';
writeSecure(file, secret, scope);

assert.equal(readSecure(file), secret, 'round trip');
const raw = fs.readFileSync(file);
assert.equal(raw.subarray(0, 5).toString(), 'PRC1\n');
assert.ok(!raw.includes(Buffer.from('BillingService')) && !raw.includes(Buffer.from('aaaaaaaa')), 'no plaintext and no key material in the bytes');
assert.deepEqual({ ...readHeader(file), salt: 'x' }, { v: 1, workspace: 'acme', repo: 'demo', pr: 3, salt: 'x' });
console.log('  ✓ round trip; file bytes hold neither content nor the repository id; header readable without a key');

// Wrong key (another repository's id) cannot decrypt.
AccessGate.setMaterial('acme', 'demo', '{11111111-2222-4333-8444-555555555555}');
assert.throws(() => readSecure(file), /Cannot decrypt/);
AccessGate.setMaterial('acme', 'demo', UUID);

// Any modification is detected: a flipped ciphertext bit, an edited header, a truncated file.
const flipped = Buffer.from(raw); flipped[flipped.length - 20] ^= 1;
assert.throws(() => decryptBuffer(flipped), /Cannot decrypt/);
const header = raw.toString('latin1').replace('"pr":3', '"pr":4');
assert.throws(() => decryptBuffer(Buffer.from(header, 'latin1')), /Cannot decrypt/);
assert.throws(() => decryptBuffer(raw.subarray(0, raw.length - 4)), /Cannot decrypt/);
assert.throws(() => decryptBuffer(raw.subarray(0, raw.indexOf(0x0a, 5) + 10)), /Cannot decrypt/);
console.log('  ✓ wrong key, flipped bit, edited header and truncation are all rejected');

// Pre-encryption files are recognised (callers re-sync them) and purged without a key.
fs.writeFileSync('ai-context/acme/demo/pr_3/old.json', '{"title":"plaintext"}');
fs.mkdirSync('ai-context/acme/old/pr_9/files', { recursive: true });
fs.writeFileSync('ai-context/acme/old/pr_9/files/file_0001.md', '# plaintext');
assert.throws(() => readSecure('ai-context/acme/demo/pr_3/old.json'), PlaintextFileError);
AccessGate.lockAll();
assert.equal(purgePlaintext('ai-context'), 2);
assert.ok(fs.existsSync(file) && !fs.existsSync('ai-context/acme/old'), 'encrypted file kept, emptied folders removed');
console.log('  ✓ plaintext files are detected and purge-plaintext removes only them');
