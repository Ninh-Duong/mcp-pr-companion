import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { AccessGate } from '../src/core/auth/access-gate.ts';
import { LiveReviewSnapshotStore } from '../src/core/output/live-review-snapshot.store.ts';
import { readSecure, writeSecure } from '../src/core/storage/secure-file.ts';
import {
  LiveReviewCommentV1Schema,
  LiveReviewIndexV1Schema
} from '../src/core/output/schema/live-review.v1.schema.ts';

const scope = { workspace: 'acme', repoSlug: 'demo', prId: 42 };
const prDir = 'ai-context/acme/demo/pr_42';
const repositoryId = '{aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee}';
const comment = {
  id: 3,
  parent_id: null,
  author: 'Reviewer',
  author_kind: 'person' as const,
  created_on: '2026-11-11T10:00:00.000Z',
  resolved: false,
  file_id: 'file_0001',
  path: 'src/example.ts',
  line: 12,
  text: 'Please handle the empty response.'
};

AccessGate.setMaterial(scope.workspace, scope.repoSlug, repositoryId);

assert.equal(LiveReviewIndexV1Schema.parse({
  schema_version: 1,
  snapshot_id: 'snap-1',
  fetched_at: '2026-11-11T10:00:00.000Z',
  source_commit: 'abc123',
  comment_count: 1,
  complete: true
}).schema_version, 1);
assert.throws(() => LiveReviewIndexV1Schema.parse({ schema_version: 4 }), /Required|Invalid/);
assert.equal(LiveReviewCommentV1Schema.parse(comment).id, 3);
assert.throws(() => LiveReviewCommentV1Schema.parse({ ...comment, author_kind: 'unknown' }), /Invalid/);
assert.throws(() => LiveReviewCommentV1Schema.parse({ ...comment, severity: 'high' }), /Unrecognized key/);

const snapshot = {
  schema_version: 1 as const,
  snapshot_id: 'snap-2026-11-11T100000Z',
  fetched_at: '2026-11-11T10:00:00.000Z',
  source_commit: 'abc123',
  comment_count: 1,
  complete: true as const,
  comments: [comment]
};

LiveReviewSnapshotStore.publishComplete(prDir, scope, snapshot);
const loaded = LiveReviewSnapshotStore.readCurrent(prDir);
assert.deepEqual(loaded, { ...snapshot, warnings: [] }, 'publishes and reads the current complete snapshot with default warning metadata');

const currentPath = `${prDir}/live-review/current.json`;
const indexPath = `${prDir}/live-review/snapshots/${snapshot.snapshot_id}/index.json`;
const commentsPath = `${prDir}/live-review/snapshots/${snapshot.snapshot_id}/comments.jsonl`;
const index = JSON.parse(readSecure(indexPath));
assert.deepEqual(index.warnings, [], 'complete snapshot index carries an empty warnings list by default');
const legacyIndex = { ...index };
delete legacyIndex.warnings;
writeSecure(indexPath, JSON.stringify(legacyIndex), scope);
assert.deepEqual(LiveReviewSnapshotStore.readCurrent(prDir)?.warnings, [], 'schema-v1 indexes written before warnings were added remain readable');
writeSecure(indexPath, JSON.stringify(index), scope);
for (const file of [currentPath, indexPath, commentsPath]) {
  const bytes = fs.readFileSync(file);
  assert.equal(bytes.subarray(0, 5).toString(), 'PRC1\n', `${file} is encrypted`);
  assert.ok(!bytes.includes(Buffer.from('Please handle')), 'comment text is not plaintext on disk');
}

const lastAttempt = {
  schema_version: 1 as const,
  attempted_at: '2026-11-11T10:05:00.000Z',
  complete: false,
  warnings: ['Comment refresh failed: page unavailable'],
  source_commit: 'abc123',
  retained_snapshot_id: snapshot.snapshot_id
};
LiveReviewSnapshotStore.recordLastAttempt(prDir, scope, lastAttempt);
const attemptPath = `${prDir}/live-review/last-attempt.json`;
const attemptBytes = fs.readFileSync(attemptPath);
assert.equal(attemptBytes.subarray(0, 5).toString(), 'PRC1\n', 'last attempt metadata is encrypted');
assert.ok(!attemptBytes.includes(Buffer.from('page unavailable')), 'refresh warning is not plaintext on disk');
assert.deepEqual(LiveReviewSnapshotStore.readLastAttempt(prDir), lastAttempt);
assert.equal(LiveReviewSnapshotStore.readCurrent(prDir)?.snapshot_id, snapshot.snapshot_id, 'recording an incomplete attempt does not advance the complete pointer');

const secondSnapshot = { ...snapshot, snapshot_id: 'snap-2', source_commit: 'def456' };
assert.throws(() => LiveReviewSnapshotStore.publishComplete(prDir, scope, { ...secondSnapshot, complete: false }), /complete/i);
assert.equal(LiveReviewSnapshotStore.readCurrent(prDir)?.snapshot_id, snapshot.snapshot_id, 'incomplete data cannot replace current pointer');
assert.throws(() => LiveReviewSnapshotStore.publishComplete(prDir, scope, snapshot), /already exists/i);
assert.equal(LiveReviewSnapshotStore.readCurrent(prDir)?.snapshot_id, snapshot.snapshot_id, 'failed publication leaves the current pointer intact');

const oldStatusDir = 'ai-context/acme/demo/pr_42_open';
const newStatusDir = 'ai-context/acme/demo/pr_42_merged';
const oldStatusSnapshot = { ...snapshot, snapshot_id: 'status-old', fetched_at: '2026-11-11T10:00:00.000Z' };
const newStatusSnapshot = { ...snapshot, snapshot_id: 'status-new', fetched_at: '2026-11-11T11:00:00.000Z' };
LiveReviewSnapshotStore.publishComplete(oldStatusDir, scope, newStatusSnapshot);
LiveReviewSnapshotStore.publishComplete(newStatusDir, scope, oldStatusSnapshot);
LiveReviewSnapshotStore.migrateStatusDirectory(oldStatusDir, newStatusDir, scope);
assert.equal(LiveReviewSnapshotStore.readCurrent(newStatusDir)?.snapshot_id, newStatusSnapshot.snapshot_id, 'status migration keeps the newest complete snapshot');

const mergeSourceDir = 'ai-context/acme/demo/pr_42_merge_source';
const mergeTargetDir = 'ai-context/acme/demo/pr_42_merge_target';
const mergeSourceSnapshot = { ...snapshot, snapshot_id: 'merge-source', fetched_at: '2026-11-11T12:00:00.000Z' };
const mergeTargetSnapshot = { ...snapshot, snapshot_id: 'merge-target-old', fetched_at: '2026-11-11T10:00:00.000Z' };
LiveReviewSnapshotStore.publishComplete(mergeSourceDir, scope, mergeSourceSnapshot);
LiveReviewSnapshotStore.publishComplete(mergeTargetDir, scope, mergeTargetSnapshot);
const olderSourceAttempt = {
  ...lastAttempt,
  attempted_at: '2026-11-11T12:05:00.000Z',
  warnings: ['Older source refresh warning'],
  retained_snapshot_id: mergeSourceSnapshot.snapshot_id
};
const newestTargetAttempt = {
  ...lastAttempt,
  attempted_at: '2026-11-11T12:10:00.000Z',
  warnings: ['Newest target refresh warning'],
  retained_snapshot_id: mergeSourceSnapshot.snapshot_id
};
LiveReviewSnapshotStore.recordLastAttempt(mergeSourceDir, scope, olderSourceAttempt);
LiveReviewSnapshotStore.recordLastAttempt(mergeTargetDir, scope, newestTargetAttempt);
LiveReviewSnapshotStore.migrateStatusDirectory(mergeSourceDir, mergeTargetDir, scope);
assert.equal(LiveReviewSnapshotStore.readCurrent(mergeTargetDir)?.snapshot_id, mergeSourceSnapshot.snapshot_id, 'migration keeps the newer source complete snapshot');
assert.deepEqual(LiveReviewSnapshotStore.readLastAttempt(mergeTargetDir), newestTargetAttempt, 'migration preserves the newest relevant target attempt over an older source attempt');

const noSourceAttemptDir = 'ai-context/acme/demo/pr_42_no_source_attempt';
const targetAttemptDir = 'ai-context/acme/demo/pr_42_target_attempt';
const targetAttemptSnapshot = { ...snapshot, snapshot_id: 'target-attempt-old', fetched_at: '2026-11-11T10:00:00.000Z' };
const sourceWithoutAttemptSnapshot = { ...snapshot, snapshot_id: 'source-without-attempt', fetched_at: '2026-11-11T12:00:00.000Z' };
LiveReviewSnapshotStore.publishComplete(noSourceAttemptDir, scope, sourceWithoutAttemptSnapshot);
LiveReviewSnapshotStore.publishComplete(targetAttemptDir, scope, targetAttemptSnapshot);
const relevantTargetAttempt = {
  ...lastAttempt,
  attempted_at: '2026-11-11T12:15:00.000Z',
  warnings: ['Retained target refresh warning'],
  retained_snapshot_id: sourceWithoutAttemptSnapshot.snapshot_id
};
LiveReviewSnapshotStore.recordLastAttempt(targetAttemptDir, scope, relevantTargetAttempt);
LiveReviewSnapshotStore.migrateStatusDirectory(noSourceAttemptDir, targetAttemptDir, scope);
assert.equal(LiveReviewSnapshotStore.readCurrent(targetAttemptDir)?.snapshot_id, sourceWithoutAttemptSnapshot.snapshot_id);
assert.deepEqual(LiveReviewSnapshotStore.readLastAttempt(targetAttemptDir), relevantTargetAttempt, 'migration can add a relevant target attempt when the source has none');

const staleSourceAttemptDir = 'ai-context/acme/demo/pr_42_stale_source_attempt';
const noTargetAttemptDir = 'ai-context/acme/demo/pr_42_no_target_attempt';
const staleSourceSnapshot = { ...snapshot, snapshot_id: 'stale-source-attempt', fetched_at: '2026-11-11T12:00:00.000Z' };
LiveReviewSnapshotStore.publishComplete(staleSourceAttemptDir, scope, staleSourceSnapshot);
LiveReviewSnapshotStore.publishComplete(noTargetAttemptDir, scope, targetAttemptSnapshot);
const mismatchedSourceAttempt = {
  ...lastAttempt,
  attempted_at: '2026-11-11T12:20:00.000Z',
  warnings: ['Warning for another snapshot'],
  retained_snapshot_id: 'different-snapshot'
};
LiveReviewSnapshotStore.recordLastAttempt(staleSourceAttemptDir, scope, mismatchedSourceAttempt);
LiveReviewSnapshotStore.migrateStatusDirectory(staleSourceAttemptDir, noTargetAttemptDir, scope);
assert.equal(LiveReviewSnapshotStore.readCurrent(noTargetAttemptDir)?.snapshot_id, staleSourceSnapshot.snapshot_id);
assert.equal(LiveReviewSnapshotStore.readLastAttempt(noTargetAttemptDir), undefined, 'migration drops source attempt metadata unrelated to the winning snapshot');

const migrationSourceDir = 'ai-context/acme/demo/pr_42_retry';
const migrationTargetDir = 'ai-context/acme/demo/pr_42_retry_target';
LiveReviewSnapshotStore.publishComplete(migrationSourceDir, scope, newStatusSnapshot);
const originalRenameForMigration = fs.renameSync;
(fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = ((from: fs.PathLike, to: fs.PathLike, ...args: unknown[]) => {
  if (path.resolve(String(to)) === path.resolve(`${migrationTargetDir}/live-review`)) throw new Error('simulated sidecar migration failure');
  return (originalRenameForMigration as (...renameArgs: unknown[]) => void)(from, to, ...args);
}) as typeof fs.renameSync;
try {
  assert.throws(() => LiveReviewSnapshotStore.migrateStatusDirectory(migrationSourceDir, migrationTargetDir, scope), /sidecar migration failure/i);
} finally {
  (fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = originalRenameForMigration;
}
assert.equal(LiveReviewSnapshotStore.readCurrent(migrationSourceDir)?.snapshot_id, newStatusSnapshot.snapshot_id, 'failed status migration keeps the source snapshot readable');

const originalRenameSync = fs.renameSync;
(fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = ((from: fs.PathLike, to: fs.PathLike, ...args: unknown[]) => {
  if (path.resolve(String(to)) === path.resolve(currentPath)) throw new Error('simulated current pointer replacement failure');
  return (originalRenameSync as (...renameArgs: unknown[]) => void)(from, to, ...args);
}) as typeof fs.renameSync;
try {
  assert.throws(() => LiveReviewSnapshotStore.publishComplete(prDir, scope, secondSnapshot), /pointer replacement failure/i);
} finally {
  (fs as unknown as { renameSync: typeof fs.renameSync }).renameSync = originalRenameSync;
}
assert.equal(LiveReviewSnapshotStore.readCurrent(prDir)?.snapshot_id, snapshot.snapshot_id, 'failed pointer replacement leaves the previous encrypted snapshot readable');
for (const name of fs.readdirSync(`${prDir}/live-review`)) {
  if (name.startsWith('current.json.tmp-')) fs.rmSync(`${prDir}/live-review/${name}`, { force: true });
}

const originalReadFileSync = fs.readFileSync;
(fs as unknown as { readFileSync: typeof fs.readFileSync }).readFileSync = ((file: fs.PathOrFileDescriptor, ...args: unknown[]) => {
  const result = (originalReadFileSync as (...readArgs: unknown[]) => Buffer | string)(file, ...args);
  const filePath = typeof file === 'string' ? path.resolve(file) : '';
  if (filePath.includes(`${path.sep}.tmp-`) && filePath.endsWith(`${path.sep}index.json`)) {
    const bytes = Buffer.isBuffer(result) ? Buffer.from(result) : Buffer.from(result);
    bytes[bytes.length - 20] ^= 1;
    return bytes;
  }
  return result;
}) as typeof fs.readFileSync;
try {
  assert.throws(() => LiveReviewSnapshotStore.publishComplete(prDir, scope, { ...snapshot, snapshot_id: 'snap-staged-failure' }), /Cannot decrypt/i);
} finally {
  (fs as unknown as { readFileSync: typeof fs.readFileSync }).readFileSync = originalReadFileSync;
}
assert.equal(LiveReviewSnapshotStore.readCurrent(prDir)?.snapshot_id, snapshot.snapshot_id, 'staged encrypted validation failure leaves the previous snapshot readable');
assert.ok(!fs.readdirSync(`${prDir}/live-review/snapshots`).some(name => name.startsWith('.tmp-')), 'failed staged validation removes the temporary encrypted snapshot');

writeSecure(commentsPath, '{"id":', scope);
assert.throws(() => LiveReviewSnapshotStore.readCurrent(prDir), /comment record 1 is invalid/i, 'malformed encrypted JSONL fails closed');
writeSecure(commentsPath, JSON.stringify(comment), scope);
const tampered = fs.readFileSync(commentsPath);
tampered[tampered.length - 20] ^= 1;
fs.writeFileSync(commentsPath, tampered);
assert.throws(() => LiveReviewSnapshotStore.readCurrent(prDir), /Cannot decrypt/i, 'tampered encrypted JSONL fails authentication');

AccessGate.lockAll();
assert.throws(() => LiveReviewSnapshotStore.readCurrent(prDir), /No access/);
console.log('  ✓ review sidecar validates, encrypts, and retains the current complete snapshot');
