// Drives the real McpServer through an in-memory MCP client against a fake Bitbucket (globalThis.fetch),
// so zod defaults, validation and error shaping run exactly as in production. Runs in a temp cwd (tests/run.mjs).
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

process.env.BITBUCKET_EMAIL = 'dev@example.com';
process.env.BITBUCKET_API_TOKEN = 'test-token';
process.env.AI_CONTEXT_COMPANY = 'acme';
process.env.PRIVACY_FILE_PATH_MODE = 'sanitized';
process.env.FRESHNESS_TTL_SECONDS = '0'; // every call re-checks here; tests/freshness.test.ts covers the TTL
delete process.env.BITBUCKET_REPOSITORY;
delete process.env.ALLOWED_EMAILS;
delete process.env.PR_COMPANION_CONFIG_SOURCES;

const { createServer } = await import('../src/mcp/tools.ts');
const { ConfigManager } = await import('../src/config/config.manager.ts');
const { PRContextService } = await import('../src/mcp/context.service.ts');
const { AccessGate } = await import('../src/core/auth/access-gate.ts');
const { OutputReader } = await import('../src/core/output/output.reader.ts');
const { DataStore } = await import('../src/core/storage/data.store.ts');
const { readSecure, writeSecure } = await import('../src/core/storage/secure-file.ts');
const { SyncPRsService } = await import('../src/core/orchestration/sync-prs.service.ts');
const REPO_UUID = '{7d3c0a52-1111-4222-8333-944455556666}';

const PR_URL = 'https://bitbucket.org/acme/demo-repo/pull-requests/7';
const REAL_PATH = 'src/api/internal/billing/InvoiceController.ts';
const bigBody = Array.from({ length: 400 }, (_, i) => `+  const line${i} = compute(${i});`).join('\n');
let extraLine = '';
const diffText = (n: number) =>
  `diff --git a/${REAL_PATH} b/${REAL_PATH}\nindex 111..222 100644\n--- a/${REAL_PATH}\n+++ b/${REAL_PATH}\n@@ -1,1 +1,${n} @@\n${bigBody}${extraLine}\n`;

let sourceHash = 'aaaaaaaaaaaa';
let prState = 'OPEN';
let prDraft = true;
let userStatus = 200;
let repoStatus = 200;
let metadataStatus = 200;
let statusesStatus = 200;
let commentsStatus = 200;
const calls: Record<string, number> = { metadata: 0, diff: 0, comments: 0, user: 0 };
globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  const ok = (body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  if (url.endsWith('/repositories/acme/demo-repo')) {
    return repoStatus === 200 ? ok({ uuid: REPO_UUID, full_name: 'acme/demo-repo' }) : new Response('{}', { status: repoStatus, statusText: 'Forbidden' });
  }
  if (url.endsWith('/2.0/user')) {
    calls.user++;
    return userStatus === 200 ? ok({ uuid: '{u}', display_name: 'Dev' }) : new Response('{}', { status: userStatus, statusText: 'Unauthorized' });
  }
  if (url.endsWith('/pullrequests/7')) {
    calls.metadata++;
    if (metadataStatus !== 200) return new Response('{}', { status: metadataStatus, statusText: 'Internal Server Error' });
    return ok({
      id: 7,
      title: 'Add invoice export endpoint',
      description: 'Adds a public export API.',
      state: prState,
      draft: prDraft,
      source: { branch: { name: 'feature/WCE-12-export' }, commit: { hash: sourceHash } },
      destination: { branch: { name: 'main' }, commit: { hash: 'bbbbbbbbbbbb' } },
      participants: [
        { role: 'REVIEWER', approved: true, state: 'approved', user: { type: 'user', display_name: 'Alice Approver' } },
        { role: 'PARTICIPANT', approved: false, state: 'changes_requested', user: { type: 'app_user', display_name: 'Bot Requester' } }
      ]
    });
  }
  if (url.includes('/pullrequests/7/statuses')) {
    if (statusesStatus !== 200) return new Response('{}', { status: statusesStatus, statusText: 'Internal Server Error' });
    return ok({ values: [
      { key: 'build', name: 'Pipeline #12', state: 'SUCCESSFUL', updated_on: '2026-01-01T00:00:00Z', links: { commit: { href: `https://api.bitbucket.org/2.0/repositories/acme/demo-repo/commit/${sourceHash}` } } },
      { key: 'build', name: 'Pipeline #13', state: 'FAILED', description: '2 tests failed, ask qa@example.com', updated_on: '2026-01-02T00:00:00Z', links: { commit: { href: `https://api.bitbucket.org/2.0/repositories/acme/demo-repo/commit/${sourceHash}` } } },
      { key: 'build', name: 'Pipeline #14', state: 'SUCCESSFUL', updated_on: '2026-01-03T00:00:00Z', links: { commit: { href: 'https://api.bitbucket.org/2.0/repositories/acme/demo-repo/commit/999999999999' } } },
      { key: 'lint', name: 'Lint', state: 'SUCCESSFUL', updated_on: '2026-01-01T00:00:00Z', links: { commit: { href: 'https://api.bitbucket.org/2.0/repositories/acme/demo-repo/commit/999999999999' } } },
      { name: 'Sonar', state: 'INPROGRESS', updated_on: '2026-01-01T00:00:00Z', links: { commit: { href: `https://api.bitbucket.org/2.0/repositories/acme/demo-repo/commit/${sourceHash}` } } }
    ] });
  }
  if (url.includes('/pullrequests/7/comments')) {
    calls.comments++;
    if (commentsStatus !== 200) return new Response('{}', { status: commentsStatus, statusText: 'Internal Server Error' });
    return ok({ values: [
      { id: 3, parent: { id: 1 }, content: { raw: 'done, token ATATT3xFfGF0abcdefghijklmnop0123 ' + 'x'.repeat(5000) }, resolution: { type: 'resolved' }, created_on: '2026-01-02' },
      { id: 1, content: { raw: 'Please rename this, ping dev@example.com' }, user: { type: 'app_user', display_name: 'Reviewer' }, created_on: '2026-01-01', inline: { path: REAL_PATH, to: 10 } },
      { id: 2, deleted: true, content: { raw: 'gone' } }
    ] });
  }
  if (url.includes('/pullrequests?')) {
    const state = new URL(url).searchParams.get('state') || 'OPEN';
    return ok({ values: [{ id: 7, title: 'Add invoice export endpoint', state, draft: prDraft, author: { uuid: '{u}' }, updated_on: '2026-01-03',
      source: { branch: { name: 'feature/WCE-12-export' }, commit: { hash: sourceHash } }, destination: { branch: { name: 'main' }, commit: { hash: 'bbbbbbbbbbbb' } } }] });
  }
  if (url.includes('/commits')) return ok({ values: [{ hash: sourceHash + 'ffff', message: 'WCE-12 export invoices' }] });
  if (url.includes('/diffstat')) {
    return ok({ values: [{ status: 'modified', lines_added: 400, lines_removed: 0, old: { path: REAL_PATH }, new: { path: REAL_PATH } }] });
  }
  if (url.endsWith('/diff')) {
    calls.diff++;
    return ok(diffText(400));
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const server = createServer();
const client = new Client({ name: 'test', version: '0' });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);

const call = async (name: string, args: Record<string, unknown>) => {
  const res: any = await client.callTool({ name, arguments: args });
  return { isError: Boolean(res.isError), text: res.content[0].text as string };
};

// 1. Local tools before any sync
assert.deepEqual(JSON.parse((await call('get_pr_sync_status', { pr_url: PR_URL })).text), { synced: false });
const early = await call('search_pr_files', { pr_url: PR_URL });
assert.ok(early.isError && early.text.startsWith('Error: PR is not synced'), 'search before sync is an isError result');
console.log('  ✓ local tools report "not synced" before the first context pack');

// 2. First context pack syncs from Bitbucket
const pack = await call('get_pr_context_pack', { pr_url: PR_URL });
assert.ok(!pack.isError, pack.text);
assert.match(pack.text, /Add invoice export endpoint/);
assert.equal(calls.diff, 1);
assert.equal(calls.metadata, 1, 'the first sync fetches PR metadata once and the live section reuses it');
assert.ok(!pack.text.includes('get_pr_comments'), 'the pack does not send agents to get_pr_comments for threads it already summarizes');
console.log('  ✓ get_pr_context_pack syncs on first use');
assert.match(pack.text, /## Review status \(live\)\nState: OPEN \(draft\)\nApprovals: 1 · Changes requested: 1 · Participants: 2 \(reviewers: 1\)\nBuild: 1 failed, 0 passed, 1 running; 1 older commit/);
assert.match(pack.text, /- FAILED Pipeline #13: 2 tests failed, ask/);
assert.match(pack.text, /- SUCCESSFUL Lint \(older commit\)/);
assert.ok(!/Pipeline #12|Alice Approver|Bot Requester|qa@example\.com/.test(pack.text), 'live review data has no names or emails');
assert.match(pack.text, /## Review threads \(live\)\nOpen: 1 \(1 from apps\) · Resolved: 0\n- file_0001 \(1 open, 1 from apps, line 10\): Please rename this, ping/);
assert.ok(!pack.text.includes('dev@example.com'), 'live review comment is sanitized');
console.log('  ✓ context pack includes sanitized live approvals, build status, and review threads');

commentsStatus = 500;
const noComments = await call('get_pr_context_pack', { pr_url: PR_URL });
commentsStatus = 200;
assert.ok(!noComments.isError);
assert.match(noComments.text, /## Review threads \(live\)\nUnavailable:/);
statusesStatus = 500;
const noBuild = await call('get_pr_context_pack', { pr_url: PR_URL });
statusesStatus = 200;
assert.ok(!noBuild.isError);
assert.match(noBuild.text, /Approvals: 1 .*\nBuild: unavailable \(/);
console.log('  ✓ live review service failures do not fail the cached context pack');

metadataStatus = 500;
const priorCommentCalls = calls.comments;
const offline = await call('get_pr_context_pack', { pr_url: PR_URL });
metadataStatus = 200;
assert.ok(!offline.isError);
assert.match(offline.text, /^Note: could not check Bitbucket/);
assert.match(offline.text, /## Live review data\nSkipped: Bitbucket could not be reached\./);
assert.equal(calls.comments, priorCommentCalls, 'skip live calls if metadata check failed');
console.log('  ✓ cached context is available offline without waiting on other live endpoints');

// 3. Read Strategy lists the files to open next (regression: it read a non-existent field)
assert.match(pack.text, /Read next: .*file_0001/);
console.log('  ✓ context pack Read Strategy lists next file ids');
const draftListing = JSON.parse((await call('list_synced_prs', { repository: 'acme/demo-repo', status: 'draft' })).text);
assert.equal(draftListing.total, 1);
assert.deepEqual(draftListing.prs.map((pr: any) => [pr.pr_url, pr.id, pr.pr_status]), [[PR_URL, 7, 'draft']]);
assert.equal(draftListing.next_offset, null);
console.log('  ✓ list_synced_prs exposes encrypted local PRs by status');

// 4. Unchanged commits: freshness check only, no full re-sync
await call('get_pr_context_pack', { pr_url: PR_URL });
assert.equal(calls.diff, 1, 'no re-download while the head commits are unchanged');

// 5. New source commit: automatic re-sync, and the pack names the files that changed
sourceHash = 'cccccccccccc';
extraLine = '\n+  const added = 1;';
const metadataBeforeResync = calls.metadata;
const resynced = await call('get_pr_context_pack', { pr_url: PR_URL });
assert.equal(calls.metadata, metadataBeforeResync + 1, 'the re-sync and the live section reuse the metadata of the freshness check');
assert.match(resynced.text, /## Changed since last sync \(rev_aaaaaaa_bbbbbbb\)\n- file_0001 `src\/\.\.\.\/billing\/InvoiceController\.ts` \(modified\)/);
assert.equal(calls.diff, 2, 're-sync after the source commit moved');
assert.equal(JSON.parse((await call('get_pr_sync_status', { pr_url: PR_URL })).text).source_commit, sourceHash);
console.log('  ✓ stale revision is detected by commit hash and re-synced');

// 6. Concurrent refreshes share one fetch
await Promise.all([1, 2, 3].map(() => call('get_pr_context_pack', { pr_url: PR_URL, refresh: true })));
assert.equal(calls.diff, 3, 'three concurrent refreshes trigger one download');
console.log('  ✓ concurrent refreshes are deduplicated');

// 7. Search, then paged file reads
const found = JSON.parse((await call('search_pr_files', { pr_url: PR_URL, language: 'typescript' })).text);
assert.equal(found.total, 1);
assert.equal(found.files[0].path, 'src/.../billing/InvoiceController.ts');

const changes = JSON.parse((await call('get_pr_file_changes', { pr_url: PR_URL, file_id: 'file_0001', max_chars: 500 })).text);
assert.equal(changes.patch.text.length, 500);
assert.equal(changes.patch.next_offset, 500);
const originalGetFileChange = OutputReader.getFileChange;
try {
  (OutputReader as any).getFileChange = () => ({ change: { symbols: Array.from({ length: 51 }, (_, i) => ({ name: `symbol${i}` })) } });
  const capped = JSON.parse((await call('get_pr_file_changes', { pr_url: PR_URL, file_id: 1, include_patch: false })).text);
  assert.equal(capped.change.symbols.length, 50);
  assert.equal(capped.change.symbols_total, 51);
} finally {
  (OutputReader as any).getFileChange = originalGetFileChange;
}
const page2 = JSON.parse((await call('get_pr_file_changes', { pr_url: PR_URL, file_id: 1, offset: 500, max_chars: 500 })).text);
assert.equal(page2.patch.text.length, 500);
assert.notEqual(page2.patch.text, changes.patch.text);
assert.ok(page2.patch.total_chars > 1000);

const fileCtx = await call('get_pr_file_context', { pr_url: PR_URL, file_id: 'file_0001', max_chars: 1000 });
assert.match(fileCtx.text, /continue with offset 1000\.$/);
console.log('  ✓ file tools page output by offset/max_chars');

// 8. Privacy: the real path never leaves the server (diff headers included)
const fullPatch = JSON.parse((await call('get_pr_file_changes', { pr_url: PR_URL, file_id: 1, max_chars: 100_000 })).text).patch.text;
assert.ok(!fullPatch.includes(REAL_PATH), 'sanitized mode must not leak the full path through diff headers');
assert.ok(!fileCtx.text.includes(REAL_PATH));
console.log('  ✓ diff headers use the sanitized path');

// 9. Manifest keeps the PR draft flag
const prDir = path.resolve('ai-context', 'acme', 'acme', 'demo-repo', 'draft', 'pr_7');
assert.equal(JSON.parse(readSecure(path.join(prDir, 'manifest.json'))).is_draft, true);
assert.equal(JSON.parse((await call('get_pr_sync_status', { pr_url: PR_URL })).text).pr_status, 'draft');
console.log('  ✓ manifest.is_draft comes from Bitbucket');

// 9a. Encrypted at rest: every file starts with PRC1 and leaks neither content nor the key material
const rawFiles: string[] = [];
const walk = (dir: string) => fs.readdirSync(dir, { withFileTypes: true }).forEach(e => e.isDirectory() ? walk(path.join(dir, e.name)) : rawFiles.push(path.join(dir, e.name)));
walk(prDir);
assert.ok(rawFiles.length > 5);
for (const file of rawFiles) {
  const raw = fs.readFileSync(file);
  assert.equal(raw.subarray(0, 5).toString(), 'PRC1\n', `${file} is encrypted`);
  const text = raw.toString('latin1');
  assert.ok(!text.includes('invoice') && !text.includes('InvoiceController') && !text.includes('7d3c0a52'), `${file} leaks nothing`);
}
console.log(`  ✓ ${rawFiles.length} files on disk are encrypted (no title, path or repository id in the bytes)`);

// 9a'. No repository access: every read is refused, cached data stays sealed
AccessGate.lockAll();
repoStatus = 403;
for (const [tool, args] of [['get_pr_context_pack', { pr_url: PR_URL }], ['search_pr_files', { pr_url: PR_URL }], ['get_pr_file_context', { pr_url: PR_URL, file_id: 1 }], ['get_pr_sync_status', { pr_url: PR_URL }]] as const) {
  const res = await call(tool, args);
  assert.ok(res.isError && res.text.startsWith('Error: No access: this account cannot read acme/demo-repo'), `${tool} refused`);
}
repoStatus = 200;
console.log('  ✓ without repository access every read tool answers "No access"');

// 9b. Comments: deleted dropped, sanitized, inline mapped to file_id, paged, resolved filter
const comments = JSON.parse((await call('get_pr_comments', { pr_url: PR_URL })).text);
assert.equal(comments.total, 2);
assert.deepEqual(comments.comments.map((c: any) => c.id), [1, 3]);
const inline = comments.comments[0];
assert.equal(inline.file_id, 'file_0001');
assert.equal(inline.path, 'src/.../billing/InvoiceController.ts');
assert.equal(inline.line, 10);
assert.ok(!inline.text.includes('dev@example.com') && !('author' in inline), 'email redacted, author removed by default');
assert.ok(!comments.comments[1].text.includes('ATATT3x') && comments.comments[1].resolved === true);
assert.equal(inline.author_kind, 'app');
assert.match(comments.comments[1].text, /\n\[truncated: 4000 of \d+ chars\]$/);
assert.ok(comments.comments[1].text.length < 4100);
assert.equal(JSON.parse((await call('get_pr_comments', { pr_url: PR_URL, include_resolved: false })).text).total, 1);
const firstPage = JSON.parse((await call('get_pr_comments', { pr_url: PR_URL, limit: 1 })).text);
assert.equal(firstPage.comments.length, 1);
assert.equal(firstPage.next_offset, 1);
console.log('  ✓ get_pr_comments sanitizes, maps inline comments to file ids and pages');

DataStore.saveRevision('acme', 'demo-repo', 8, {
  metadata: {
    id: 8, title: 'Declined local PR', description: '', state: 'DECLINED', draft: false,
    source: { branch: { name: 'feature/declined' }, commit: { hash: 'eeeeeeeeeeee' } },
    destination: { branch: { name: 'main' }, commit: { hash: 'ffffffffffff' } }
  },
  commits: [], diffstat: [], rawDiff: '', sourceHash: 'eeeeeeeeeeee', destinationHash: 'ffffffffffff',
  coverage: { metadata: 'complete', commits: 'complete', diffstat: 'complete', diff: 'complete' }, warnings: []
});
const syncedPage1 = JSON.parse((await call('list_synced_prs', { repository: 'acme/demo-repo', limit: 1 })).text);
const syncedPage2 = JSON.parse((await call('list_synced_prs', { repository: 'acme/demo-repo', offset: 1, limit: 1 })).text);
assert.equal(syncedPage1.total, 2);
assert.equal(syncedPage1.prs.length, 1);
assert.equal(syncedPage1.next_offset, 1);
assert.equal(syncedPage2.prs.length, 1);
assert.equal(syncedPage2.next_offset, null);
assert.deepEqual(new Set([...syncedPage1.prs, ...syncedPage2.prs].map((pr: any) => pr.id)), new Set([7, 8]));
console.log('  ✓ list_synced_prs pages local PRs with next_offset');

// 9c. My open PRs
const mine = JSON.parse((await call('list_my_open_prs', { repository: 'acme/demo-repo' })).text);
assert.equal(mine.total, 1);
assert.equal(mine.prs[0].pr_url, PR_URL);
assert.ok(['cached', 'outdated'].includes(mine.prs[0].local));
const noRepo = await call('list_my_open_prs', {});
assert.ok(noRepo.isError && /BITBUCKET_REPOSITORY/.test(noRepo.text));
for (const repository of ['../etc', 'acme/../x', 'acme/demo?x=1', 'acme/demo#a', 'acme']) {
  const invalid = await call('list_my_open_prs', { repository });
  assert.ok(invalid.isError && /workspace\/repo/.test(invalid.text), repository);
}
console.log('  ✓ list_my_open_prs returns ready-to-use pr_url values');

// 10. Errors are isError results with an "Error:" prefix
const bad = await call('get_pr_context_pack', { pr_url: 'https://github.com/x/y/pull/1' });
assert.ok(bad.isError && bad.text.startsWith('Error: '));
const badId = await call('get_pr_file_context', { pr_url: PR_URL, file_id: '../../etc/passwd' });
assert.ok(badId.isError && /Invalid file_id/.test(badId.text));
console.log('  ✓ invalid input returns isError "Error: …"');

// 10b. Batch sync of my open PRs (+ AUTO_SYNC_ON_START path)
const metadataBeforeBatch = calls.metadata;
const batch = JSON.parse((await call('sync_my_open_prs', { repository: 'acme/demo-repo' })).text);
assert.deepEqual([batch.total, batch.unchanged, batch.failed], [1, 1, 0]);
assert.equal(calls.metadata, metadataBeforeBatch, 'an unchanged cached PR costs no per-PR metadata request');
assert.equal(calls.user, 1, 'the account UUID is fetched once per process for the same credentials');
assert.equal(batch.prs[0].pr_url, PR_URL);
assert.equal(batch.prs[0].ticket, 'WCE-12');
assert.ok(batch.prs[0].overall_risk && batch.prs[0].files_changed === 1);
const forced = JSON.parse((await call('sync_my_open_prs', { repository: 'acme/demo-repo', force: true })).text);
assert.equal(forced.prs[0].status, 'synced');
assert.equal(calls.metadata, metadataBeforeBatch + 1, 'a forced sync fetches metadata once (inside the sync)');
const before = calls.diff;
sourceHash = 'dddddddddddd';
process.env.BITBUCKET_REPOSITORY = 'acme/demo-repo';
await PRContextService.autoSync();
delete process.env.BITBUCKET_REPOSITORY;
assert.equal(calls.diff, before + 1, 'auto-sync re-synced the PR whose commit moved');
assert.match(fs.readFileSync('Logs/mcp-server.log', 'utf-8'), /auto_sync done total=1 synced=1 unchanged=0 failed=0/);
console.log('  ✓ sync_my_open_prs reports synced/unchanged with ticket and risk; autoSync syncs moved PRs');

prDraft = false;
await call('get_pr_context_pack', { pr_url: PR_URL });
const openDir = path.resolve('ai-context', 'acme', 'acme', 'demo-repo', 'open', 'pr_7');
assert.equal(JSON.parse(readSecure(path.join(openDir, 'manifest.json'))).is_draft, false);
assert.equal(fs.existsSync(prDir), false, 'ready PR moved out of the draft directory');
prState = 'MERGED';
await call('get_pr_context_pack', { pr_url: PR_URL });
const mergedDir = path.resolve('ai-context', 'acme', 'acme', 'demo-repo', 'merged', 'pr_7');
assert.equal(JSON.parse(readSecure(path.join(mergedDir, 'manifest.json'))).state, 'MERGED');
assert.equal(fs.existsSync(openDir), false, 'merged PR moved out of the open directory');
assert.equal(JSON.parse((await call('get_pr_sync_status', { pr_url: PR_URL })).text).pr_status, 'merged');
const mergedListing = JSON.parse((await call('list_synced_prs', { repository: 'acme/demo-repo', status: 'merged' })).text);
assert.deepEqual(mergedListing.prs.map((pr: any) => pr.pr_status), ['merged']);
console.log('  ✓ state or draft changes re-sync into the matching status directory');

// A successful sync must retry incomplete directory migration even when the PR did not change.
const legacyDir = path.resolve('ai-context', 'acme', 'acme', 'demo-repo', 'pr_7');
const migrationScope = { workspace: 'acme', repoSlug: 'demo-repo', prId: 7 };
const originalRenameSync = fs.renameSync;
const session = {
  email: 'dev@example.com', token: 'test-token', currentUserUuid: '{u}',
  repository: { workspace: 'acme', repoSlug: 'demo-repo', opaqueId: 'repo_test' },
  capabilities: { tokenAuthenticated: true, userAccess: true, repoRead: true, prRead: true, diffRead: true }
};
const beforeCanonicalSyncDiffs = calls.diff;
const canonicalSync = await SyncPRsService.execute(session, 'merged');
assert.deepEqual([canonicalSync.totalFiltered, canonicalSync.completed, canonicalSync.cached, canonicalSync.failed], [1, 0, 1, 0]);
assert.equal(calls.diff, beforeCanonicalSyncDiffs, 'correctly placed PRs remain cached');
const failMigrationOnce = (historyDir: string) => {
  let shouldFail = true;
  fs.renameSync = ((source: fs.PathLike, destination: fs.PathLike) => {
    if (shouldFail && path.resolve(String(source)) === path.resolve(historyDir)) {
      shouldFail = false;
      throw new Error('Simulated migration interruption');
    }
    return originalRenameSync(source, destination);
  }) as typeof fs.renameSync;
};
const simulateCrossVolumeOnce = (historyDir: string) => {
  let shouldFail = true;
  fs.renameSync = ((source: fs.PathLike, destination: fs.PathLike) => {
    if (shouldFail && path.resolve(String(source)) === path.resolve(historyDir)) {
      shouldFail = false;
      const error = new Error('Simulated cross-volume migration') as NodeJS.ErrnoException;
      error.code = 'EXDEV';
      throw error;
    }
    return originalRenameSync(source, destination);
  }) as typeof fs.renameSync;
};
const addLegacyHistory = (historyId: string) => {
  const historyDir = path.join(legacyDir, 'revisions', historyId);
  fs.cpSync(mergedDir, legacyDir, { recursive: true });
  fs.mkdirSync(historyDir, { recursive: true });
  writeSecure(path.join(historyDir, 'manifest.json'), JSON.stringify({
    schema_version: '4.0', state: 'OPEN', is_draft: false, title: 'Retained history'
  }), migrationScope);
  return historyDir;
};
const assertHistoryPreserved = (historyId: string) => {
  const migratedManifest = path.join(mergedDir, 'revisions', historyId, 'manifest.json');
  assert.equal(JSON.parse(readSecure(migratedManifest)).title, 'Retained history');
  assert.equal(fs.readFileSync(migratedManifest).subarray(0, 5).toString(), 'PRC1\n');
};

addLegacyHistory('rev_1111111_2222222');
AccessGate.lockAll();
repoStatus = 403;
const deniedMigration = await call('get_pr_context_pack', { pr_url: PR_URL });
assert.ok(deniedMigration.isError && deniedMigration.text.startsWith('Error: No access:'));
assert.ok(fs.existsSync(legacyDir), 'access denial leaves the legacy directory untouched');
repoStatus = 200;
AccessGate.lockAll();

const beforeMcpMigrationDiffs = calls.diff;
failMigrationOnce(path.join(legacyDir, 'revisions', 'rev_1111111_2222222'));
try {
  const interruptedMigration = await call('get_pr_context_pack', { pr_url: PR_URL });
  assert.ok(!interruptedMigration.isError, interruptedMigration.text);
} finally {
  fs.renameSync = originalRenameSync;
}
assert.equal(calls.diff, beforeMcpMigrationDiffs + 1, 'MCP retries the migration by writing a new revision');
assert.ok(fs.existsSync(legacyDir), 'failed migration leaves source revisions readable');
await call('get_pr_context_pack', { pr_url: PR_URL });
assert.equal(fs.existsSync(legacyDir), false, 'the next MCP sync removes the old directory after migration');
assertHistoryPreserved('rev_1111111_2222222');

addLegacyHistory('rev_3333333_4444444');
const beforeCliMigrationDiffs = calls.diff;
failMigrationOnce(path.join(legacyDir, 'revisions', 'rev_3333333_4444444'));
try {
  const interruptedCliMigration = await SyncPRsService.execute(session, 'merged');
  assert.deepEqual([interruptedCliMigration.totalFiltered, interruptedCliMigration.completed, interruptedCliMigration.cached, interruptedCliMigration.failed], [1, 1, 0, 0]);
} finally {
  fs.renameSync = originalRenameSync;
}
assert.equal(calls.diff, beforeCliMigrationDiffs + 1, 'CLI sync retries the migration by writing a new revision');
assert.ok(fs.existsSync(legacyDir), 'failed CLI migration leaves source revisions readable');
const cliRetry = await SyncPRsService.execute(session, 'merged');
assert.deepEqual([cliRetry.totalFiltered, cliRetry.completed, cliRetry.cached, cliRetry.failed], [1, 1, 0, 0]);
assert.equal(calls.diff, beforeCliMigrationDiffs + 2, 'the next CLI sync retries migration although the PR is unchanged');
assert.equal(fs.existsSync(legacyDir), false, 'CLI removes the old directory after history is migrated');
assertHistoryPreserved('rev_3333333_4444444');

addLegacyHistory('rev_5555555_6666666');
simulateCrossVolumeOnce(path.join(legacyDir, 'revisions', 'rev_5555555_6666666'));
try {
  const crossVolumePack = await call('get_pr_context_pack', { pr_url: PR_URL });
  assert.ok(!crossVolumePack.isError, crossVolumePack.text);
} finally {
  fs.renameSync = originalRenameSync;
}
assert.equal(fs.existsSync(legacyDir), false, 'cross-volume migration removes the source only after copying');
assertHistoryPreserved('rev_5555555_6666666');

addLegacyHistory('rev_7777777_8888888');
const conflictingTargetRevision = path.join(mergedDir, 'revisions', 'rev_7777777_8888888');
fs.mkdirSync(conflictingTargetRevision, { recursive: true });
writeSecure(path.join(conflictingTargetRevision, 'manifest.json'), JSON.stringify({
  schema_version: '4.0', state: 'MERGED', is_draft: false, title: 'Different target history'
}), migrationScope);
const conflictingMigration = await call('get_pr_context_pack', { pr_url: PR_URL });
assert.ok(!conflictingMigration.isError, conflictingMigration.text);
assert.ok(fs.existsSync(legacyDir), 'a conflicting target revision never causes the source to be deleted');
assert.equal(JSON.parse(readSecure(path.join(legacyDir, 'revisions', 'rev_7777777_8888888', 'manifest.json'))).title, 'Retained history');
console.log('  ✓ MCP and CLI sync retry interrupted migration, preserve encrypted history, and copy across volumes');

// 11. Health check: success payload, and a clear error on bad credentials (no PII in either)
const health = await call('check_bitbucket_connection', {});
assert.ok(!health.isError);
const healthBody = JSON.parse(health.text);
assert.equal(healthBody.connected, true, 'the hub smoke check reads connected: true');
assert.equal(healthBody.config_source.credentials, 'local', 'without the launcher, set credentials count as local');
assert.equal(healthBody.config_source.repository, 'unset');
process.env.PR_COMPANION_CONFIG_SOURCES = JSON.stringify({
  BITBUCKET_EMAIL: 'hub', BITBUCKET_API_TOKEN: 'hub', BITBUCKET_WORKSPACE: 'unset', BITBUCKET_REPOSITORY: 'env', ALLOWED_EMAILS: 'bogus'
});
const hubHealth = await call('check_bitbucket_connection', {});
assert.deepEqual(JSON.parse(hubHealth.text), {
  connected: true,
  config_source: { credentials: 'hub', workspace: 'unset', repository: 'env', allowed_emails: 'unset' }
});
assert.ok(!hubHealth.text.includes('test-token') && !hubHealth.text.includes('dev@example.com'), 'sources carry names only');
delete process.env.PR_COMPANION_CONFIG_SOURCES;
userStatus = 401;
const unauth = await call('check_bitbucket_connection', {});
assert.ok(unauth.isError && /HTTP 401/.test(unauth.text) && !unauth.text.includes('dev@example.com'));
userStatus = 200;
console.log('  ✓ check_bitbucket_connection reports success and auth failures');

// 12. ALLOWED_EMAILS is enforced on the MCP path
process.env.ALLOWED_EMAILS = 'someone-else@example.com';
(ConfigManager as any).cached = null;
const denied = await call('get_pr_context_pack', { pr_url: PR_URL });
assert.ok(denied.isError && /ALLOWED_EMAILS/.test(denied.text));
assert.ok((await call('check_bitbucket_connection', {})).isError, 'the health check is denied too');
console.log('  ✓ ALLOWED_EMAILS denies other accounts');

await client.close();
