import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { StorePathResolver } from '../src/core/output/store-path.resolver.js';
import { AccessGate } from '../src/core/auth/access-gate.js';
import { DataStore } from '../src/core/storage/data.store.js';
import { OutputReader } from '../src/core/output/output.reader.js';
import { writeSecure } from '../src/core/storage/secure-file.js';
import { ConfigManager } from '../src/config/config.manager.js';

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-pr-status-'));
const legacy = StorePathResolver.getBitbucketPRDir('acme', 'demo', 42, undefined, testRoot);
const draft = StorePathResolver.getBitbucketPRDir('acme', 'demo', 42, undefined, testRoot, 'draft');
const merged = StorePathResolver.getBitbucketPRDir('acme', 'demo', 42, 'example-co', testRoot, 'merged');

assert.equal(legacy, path.resolve(testRoot, 'acme', 'demo', 'pr_42'));
assert.equal(draft, path.resolve(testRoot, 'acme', 'demo', 'draft', 'pr_42'));
assert.equal(merged, path.resolve(testRoot, 'example-co', 'acme', 'demo', 'merged', 'pr_42'));
console.log('  ✓ PR context paths include the status directory and retain the legacy path');

process.env.AI_CONTEXT_ROOT = testRoot;
process.env.AI_CONTEXT_COMPANY = '';
(ConfigManager as any).cached = null;
const workspace = 'acme';
const repoSlug = 'legacy-demo';
const prId = 42;
const scope = { workspace, repoSlug, prId };
const legacyDir = StorePathResolver.getBitbucketPRDir(workspace, repoSlug, prId, undefined, testRoot);
const previousRevision = 'rev_1111111_2222222';
const previousRevisionDir = path.join(legacyDir, 'revisions', previousRevision);
fs.mkdirSync(previousRevisionDir, { recursive: true });
AccessGate.setMaterial(workspace, repoSlug, 'repository-uuid');
writeSecure(path.join(legacyDir, 'current.json'), JSON.stringify({ active_revision: previousRevision, updated_at: '2026-01-01T00:00:00.000Z' }), scope);
writeSecure(path.join(previousRevisionDir, 'manifest.json'), JSON.stringify({ schema_version: '4.0', state: 'OPEN', is_draft: false, title: 'Old PR' }), scope);
writeSecure(path.join(previousRevisionDir, 'files.index.jsonl'), '', scope);

const rawRevision = {
  metadata: {
    id: prId, title: 'Merged PR', description: '', state: 'MERGED', draft: false,
    source: { branch: { name: 'feature/demo' }, commit: { hash: 'aaaaaaaaaaaaaaaa' } },
    destination: { branch: { name: 'main' }, commit: { hash: 'bbbbbbbbbbbbbbbb' } }
  },
  commits: [], diffstat: [], rawDiff: '', sourceHash: 'aaaaaaaaaaaaaaaa', destinationHash: 'bbbbbbbbbbbbbbbb',
  coverage: { metadata: 'complete', commits: 'complete', diffstat: 'complete', diff: 'complete' }, warnings: []
} as const;

const originalRenameSync = fs.renameSync;
fs.renameSync = ((source: fs.PathLike, destination: fs.PathLike) => {
  if (String(source) === previousRevisionDir) throw new Error('Simulated migration interruption');
  return originalRenameSync(source, destination);
}) as typeof fs.renameSync;
try {
  DataStore.saveRevision(workspace, repoSlug, prId, rawRevision as any);
} finally {
  fs.renameSync = originalRenameSync;
}

const active = OutputReader.getActiveRevision(workspace, repoSlug, prId)!;
assert.equal(active.prDir, path.resolve(testRoot, workspace, repoSlug, 'merged', `pr_${prId}`));
assert.equal(active.manifest?.state, 'MERGED');
assert.equal(fs.existsSync(legacyDir), true, 'failed migration leaves the source directory available');
DataStore.saveRevision(workspace, repoSlug, prId, rawRevision as any);
assert.equal(fs.existsSync(legacyDir), false, 'a later sync retries migration after publishing the new encrypted revision');
assert.equal(OutputReader.getManifest(workspace, repoSlug, prId, previousRevision)?.title, 'Old PR', 'old revision history remains readable after migration');
console.log('  ✓ later sync retries interrupted migration and keeps revision history readable');
fs.rmSync(testRoot, { recursive: true, force: true });
