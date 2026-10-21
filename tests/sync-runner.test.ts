import assert from 'node:assert/strict';
import { parseSyncMode } from '../src/cmd/sync.runner.js';

for (const mode of ['open', 'draft', 'merged', 'declined', 'all']) {
  assert.equal(parseSyncMode(mode), mode);
}
assert.throws(() => parseSyncMode(undefined), /Usage: .*sync/);
assert.throws(() => parseSyncMode('closed'), /open.*draft.*merged.*declined.*all/i);
console.log('  ✓ sync command accepts each mode and rejects missing or unknown modes');
