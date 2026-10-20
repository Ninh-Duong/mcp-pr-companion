// Tool inputs as agents and people actually type them: PR URLs copied from the browser, short file ids.
import assert from 'node:assert/strict';
import { PRRegistry } from '../src/core/registry/pr.registry.ts';
import { OutputReader } from '../src/core/output/output.reader.ts';

// A URL copied from any PR tab resolves to the same PR, folder and in-flight key.
for (const url of [
  'https://bitbucket.org/acme/demo/pull-requests/7',
  'https://bitbucket.org/acme/demo/pull-requests/7/overview',
  'https://bitbucket.org/acme/demo/pull-requests/7/diff#chg-src/a.ts',
  'https://bitbucket.org/Acme/Demo/pull-requests/7/commits',
  'https://bitbucket.org/acme/demo/pull-requests/7/?w=1'
]) {
  const pr = PRRegistry.parseAndValidateUrl(url);
  assert.deepEqual([pr.workspace, pr.repoSlug, pr.prId], ['acme', 'demo', 7], url);
}
assert.throws(() => PRRegistry.parseAndValidateUrl('https://bitbucket.org/acme/demo/pull-requests/99999999999999999999'), /Invalid PR ID/);
assert.throws(() => PRRegistry.parseAndValidateUrl('https://bitbucket.org/acme/demo/pull-requests/7/settings'), /Invalid Bitbucket PR URL/);
console.log('  ✓ PR URLs with tab suffixes, query strings or capitals resolve to one PR; huge ids are rejected');

// file_1 means file_0001, like the number 1 already did.
assert.equal(OutputReader.normalizeFileId('file_1'), 'file_0001');
assert.equal(OutputReader.normalizeFileId('file_0012'), 'file_0012');
assert.equal(OutputReader.normalizeFileId(3), 'file_0003');
assert.throws(() => OutputReader.normalizeFileId('../../etc/passwd'), /Invalid file_id/);
console.log('  ✓ file ids are padded whatever form the agent uses');
