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
delete process.env.BITBUCKET_REPOSITORY;
delete process.env.ALLOWED_EMAILS;

const { createServer } = await import('../src/mcp/tools.ts');
const { ConfigManager } = await import('../src/config/config.manager.ts');
const { PRContextService } = await import('../src/mcp/context.service.ts');
const { AccessGate } = await import('../src/core/auth/access-gate.ts');
const { readSecure } = await import('../src/core/storage/secure-file.ts');
const REPO_UUID = '{7d3c0a52-1111-4222-8333-944455556666}';

const PR_URL = 'https://bitbucket.org/acme/demo-repo/pull-requests/7';
const REAL_PATH = 'src/api/internal/billing/InvoiceController.ts';
const bigBody = Array.from({ length: 400 }, (_, i) => `+  const line${i} = compute(${i});`).join('\n');
let extraLine = '';
const diffText = (n: number) =>
  `diff --git a/${REAL_PATH} b/${REAL_PATH}\nindex 111..222 100644\n--- a/${REAL_PATH}\n+++ b/${REAL_PATH}\n@@ -1,1 +1,${n} @@\n${bigBody}${extraLine}\n`;

let sourceHash = 'aaaaaaaaaaaa';
let userStatus = 200;
let repoStatus = 200;
const calls: Record<string, number> = { metadata: 0, diff: 0 };
globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  const ok = (body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  if (url.endsWith('/repositories/acme/demo-repo')) {
    return repoStatus === 200 ? ok({ uuid: REPO_UUID, full_name: 'acme/demo-repo' }) : new Response('{}', { status: repoStatus, statusText: 'Forbidden' });
  }
  if (url.endsWith('/2.0/user')) {
    return userStatus === 200 ? ok({ uuid: '{u}', display_name: 'Dev' }) : new Response('{}', { status: userStatus, statusText: 'Unauthorized' });
  }
  if (url.endsWith('/pullrequests/7')) {
    calls.metadata++;
    return ok({
      id: 7,
      title: 'Add invoice export endpoint',
      description: 'Adds a public export API.',
      state: 'OPEN',
      draft: true,
      source: { branch: { name: 'feature/WCE-12-export' }, commit: { hash: sourceHash } },
      destination: { branch: { name: 'main' }, commit: { hash: 'bbbbbbbbbbbb' } }
    });
  }
  if (url.includes('/pullrequests/7/comments')) {
    return ok({ values: [
      { id: 3, parent: { id: 1 }, content: { raw: 'done, token ATATT3xFfGF0abcdefghijklmnop0123' }, resolution: { type: 'resolved' }, created_on: '2026-01-02' },
      { id: 1, content: { raw: 'Please rename this, ping dev@example.com' }, user: { display_name: 'Reviewer' }, created_on: '2026-01-01', inline: { path: REAL_PATH, to: 10 } },
      { id: 2, deleted: true, content: { raw: 'gone' } }
    ] });
  }
  if (url.includes('/pullrequests?q=')) {
    return ok({ values: [{ id: 7, title: 'Add invoice export endpoint', state: 'OPEN', author: { uuid: '{u}' }, updated_on: '2026-01-03',
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
console.log('  ✓ get_pr_context_pack syncs on first use');

// 3. Read Strategy lists the files to open next (regression: it read a non-existent field)
assert.match(pack.text, /Read next: .*file_0001/);
console.log('  ✓ context pack Read Strategy lists next file ids');

// 4. Unchanged commits: freshness check only, no full re-sync
await call('get_pr_context_pack', { pr_url: PR_URL });
assert.equal(calls.diff, 1, 'no re-download while the head commits are unchanged');

// 5. New source commit: automatic re-sync, and the pack names the files that changed
sourceHash = 'cccccccccccc';
extraLine = '\n+  const added = 1;';
const resynced = await call('get_pr_context_pack', { pr_url: PR_URL });
assert.match(resynced.text, /## Changed since last sync \(rev_aaaaaaa_bbbbbbb\)\nFiles: file_0001/);
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
const prDir = path.resolve('ai-context', 'acme', 'acme', 'demo-repo', 'pr_7');
assert.equal(JSON.parse(readSecure(path.join(prDir, 'manifest.json'))).is_draft, true);
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
assert.equal(JSON.parse((await call('get_pr_comments', { pr_url: PR_URL, include_resolved: false })).text).total, 1);
const firstPage = JSON.parse((await call('get_pr_comments', { pr_url: PR_URL, limit: 1 })).text);
assert.equal(firstPage.comments.length, 1);
assert.equal(firstPage.next_offset, 1);
console.log('  ✓ get_pr_comments sanitizes, maps inline comments to file ids and pages');

// 9c. My open PRs
const mine = JSON.parse((await call('list_my_open_prs', { repository: 'acme/demo-repo' })).text);
assert.equal(mine.total, 1);
assert.equal(mine.prs[0].pr_url, PR_URL);
assert.ok(['cached', 'outdated'].includes(mine.prs[0].local));
const noRepo = await call('list_my_open_prs', {});
assert.ok(noRepo.isError && /BITBUCKET_REPOSITORY/.test(noRepo.text));
console.log('  ✓ list_my_open_prs returns ready-to-use pr_url values');

// 10. Errors are isError results with an "Error:" prefix
const bad = await call('get_pr_context_pack', { pr_url: 'https://github.com/x/y/pull/1' });
assert.ok(bad.isError && bad.text.startsWith('Error: '));
const badId = await call('get_pr_file_context', { pr_url: PR_URL, file_id: '../../etc/passwd' });
assert.ok(badId.isError && /Invalid file_id/.test(badId.text));
console.log('  ✓ invalid input returns isError "Error: …"');

// 10b. Batch sync of my open PRs (+ AUTO_SYNC_ON_START path)
const batch = JSON.parse((await call('sync_my_open_prs', { repository: 'acme/demo-repo' })).text);
assert.deepEqual([batch.total, batch.unchanged, batch.failed], [1, 1, 0]);
assert.equal(batch.prs[0].pr_url, PR_URL);
assert.equal(batch.prs[0].ticket, 'WCE-12');
assert.ok(batch.prs[0].overall_risk && batch.prs[0].files_changed === 1);
const forced = JSON.parse((await call('sync_my_open_prs', { repository: 'acme/demo-repo', force: true })).text);
assert.equal(forced.prs[0].status, 'synced');
const before = calls.diff;
sourceHash = 'dddddddddddd';
process.env.BITBUCKET_REPOSITORY = 'acme/demo-repo';
await PRContextService.autoSync();
delete process.env.BITBUCKET_REPOSITORY;
assert.equal(calls.diff, before + 1, 'auto-sync re-synced the PR whose commit moved');
assert.match(fs.readFileSync('Logs/mcp-server.log', 'utf-8'), /auto_sync done total=1 synced=1 unchanged=0 failed=0/);
console.log('  ✓ sync_my_open_prs reports synced/unchanged with ticket and risk; autoSync syncs moved PRs');

// 11. Health check: success payload, and a clear error on bad credentials (no PII in either)
const health = await call('check_bitbucket_connection', {});
assert.ok(!health.isError);
assert.deepEqual(JSON.parse(health.text), { connected: true });
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
