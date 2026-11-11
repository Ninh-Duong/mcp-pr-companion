// Freshness TTL: get_pr_context_pack skips the PR metadata request within FRESHNESS_TTL_SECONDS (default 120)
// of the last successful check, persisted as current.json freshness_checked_at. Runs in a temp cwd (tests/run.mjs).
import assert from 'node:assert/strict';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

process.env.BITBUCKET_EMAIL = 'dev@example.com';
process.env.BITBUCKET_API_TOKEN = 'test-token';
process.env.AI_CONTEXT_COMPANY = 'acme';
delete process.env.FRESHNESS_TTL_SECONDS; // the default applies
delete process.env.BITBUCKET_REPOSITORY;
delete process.env.ALLOWED_EMAILS;

const { createServer } = await import('../src/mcp/tools.ts');
const { readSecure } = await import('../src/core/storage/secure-file.ts');
const { RevisionWriter } = await import('../src/core/output/revision.writer.ts');
const { PRCurrentV4Schema } = await import('../src/core/output/schema/current.v4.schema.ts');
const { ConfigManager } = await import('../src/config/config.manager.ts');

const PR_URL = 'https://bitbucket.org/acme/demo-repo/pull-requests/7';
let sourceHash = 'aaaaaaaaaaaa';
let prState = 'OPEN';
let isDraft = false;
let metadataUnavailable = false;
const calls = { metadata: 0, commits: 0, diffstat: 0, diff: 0, statuses: 0, comments: 0, user: 0 };
globalThis.fetch = (async (input: string | URL) => {
  const url = String(input);
  const ok = (body: unknown) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status: 200 });
  if (url.endsWith('/repositories/acme/demo-repo')) return ok({ uuid: '{7d3c0a52-1111-4222-8333-944455556666}' });
  if (url.endsWith('/2.0/user')) {
    calls.user++;
    return ok({ uuid: '{u}' });
  }
  if (url.endsWith('/pullrequests/7')) {
    calls.metadata++;
    if (metadataUnavailable) return new Response('unavailable', { status: 404 });
    return ok({
      id: 7, title: 'Add export', description: '', state: prState, draft: isDraft,
      source: { branch: { name: 'feature/WCE-1' }, commit: { hash: sourceHash } },
      destination: { branch: { name: 'main' }, commit: { hash: 'bbbbbbbbbbbb' } },
      participants: [{ role: 'REVIEWER', approved: true, state: 'approved' }]
    });
  }
  if (url.includes('/pullrequests/7/statuses')) {
    calls.statuses++;
    return ok({ values: [{ key: 'build', name: 'Pipeline', state: 'SUCCESSFUL', updated_on: '2026-01-01T00:00:00Z',
      links: { commit: { href: `https://api.bitbucket.org/2.0/repositories/acme/demo-repo/commit/${sourceHash}` } } }] });
  }
  if (url.includes('/pullrequests/7/comments')) {
    calls.comments++;
    return ok({ values: [{ id: calls.comments, content: { raw: 'Review note' }, user: { type: 'user' }, created_on: '2026-01-01T00:00:00Z' }] });
  }
  if (url.includes('/pullrequests?')) {
    return ok({ values: [{ id: 7, title: 'Add export', state: 'OPEN', draft: false, author: { uuid: '{u}' }, updated_on: '2026-01-03',
      source: { branch: { name: 'feature/WCE-1' }, commit: { hash: sourceHash } }, destination: { branch: { name: 'main' }, commit: { hash: 'bbbbbbbbbbbb' } } }] });
  }
  if (url.includes('/commits')) { calls.commits++; return ok({ values: [{ hash: sourceHash, message: 'WCE-1 export' }] }); }
  if (url.includes('/diffstat')) { calls.diffstat++; return ok({ values: [{ status: 'modified', lines_added: 1, lines_removed: 0, old: { path: 'src/a.ts' }, new: { path: 'src/a.ts' } }] }); }
  if (url.endsWith('/diff')) {
    calls.diff++;
    return ok('diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1,1 +1,2 @@\n+const a = 1;\n');
  }
  return new Response('not found', { status: 404 });
}) as typeof fetch;

const server = createServer();
const client = new Client({ name: 'test', version: '0' });
const [a, b] = InMemoryTransport.createLinkedPair();
await Promise.all([server.connect(a), client.connect(b)]);
const pack = async (args: Record<string, unknown> = {}) => {
  const res: any = await client.callTool({ name: 'get_pr_context_pack', arguments: { pr_url: PR_URL, ...args } });
  assert.ok(!res.isError, res.content[0].text);
  return res.content[0].text as string;
};
const prDir = path.resolve('ai-context', 'acme', 'acme', 'demo-repo', 'open', 'pr_7');
const readCurrent = () => PRCurrentV4Schema.parse(JSON.parse(readSecure(path.join(prDir, 'current.json'))));
const realNow = Date.now;
const later = (seconds: number) => { Date.now = () => realNow() + seconds * 1000; };

assert.equal(ConfigManager.loadBase().freshness_ttl_seconds, 0, 'PR-specific reads check Bitbucket by default');
process.env.FRESHNESS_TTL_SECONDS = '120'; // Preserve coverage for deployments that explicitly configure the legacy TTL.
(ConfigManager as any).cached = null;
assert.equal(ConfigManager.loadBase().freshness_ttl_seconds, 120, 'an explicit freshness TTL remains supported');

// First pack: one sync, one metadata request shared by the sync and the live review status.
const first = await pack();
assert.deepEqual([calls.metadata, calls.commits, calls.diffstat, calls.diff], [1, 1, 1, 1]);
assert.match(first, /Approvals: 1 · Changes requested: 0/);

// Within the TTL: no metadata request; approvals say so; builds and threads stay live.
const statusesBefore = calls.statuses;
const cached = await pack();
assert.equal(calls.metadata, 1, 'no freshness request within the TTL of the sync');
assert.match(cached, /Approvals: not rechecked \(Bitbucket was checked \d+s ago; checked again after 120s\)/);
assert.match(cached, /Build: 0 failed, 1 passed, 0 running/);
assert.equal(calls.statuses, statusesBefore + 1, 'build statuses are still fetched live');
console.log('  ✓ within 120 s of the last check the pack skips the PR metadata request');

// After the TTL: checks again, finds the PR unchanged and persists the check time in current.json.
const beforeStamp = readCurrent();
assert.equal(beforeStamp.freshness_checked_at, undefined, 'a sync alone does not stamp; updated_at counts as the check');
later(121);
const rechecked = await pack();
assert.deepEqual([calls.metadata, calls.commits, calls.diffstat, calls.diff], [2, 1, 1, 1], 'one metadata request, no re-download');
assert.match(rechecked, /Approvals: 1 · Changes requested: 0/);
const stamped = readCurrent();
assert.ok(stamped.freshness_checked_at, 'freshness_checked_at written through the secure writer');
assert.deepEqual({ ...stamped, freshness_checked_at: undefined }, { ...beforeStamp, freshness_checked_at: undefined }, 'every other field is unchanged');
Date.now = realNow;
await pack();
assert.equal(calls.metadata, 2, 'the persisted check starts a new TTL window');
console.log('  ✓ after 120 s the pack checks again and persists freshness_checked_at in current.json');

// A new commit inside the window is picked up once the window ends.
sourceHash = 'cccccccccccc';
await pack();
assert.equal(calls.diff, 1, 'inside the window the cached revision is served');
later(1000);
await pack();
Date.now = realNow;
assert.deepEqual([calls.metadata, calls.commits, calls.diffstat, calls.diff], [3, 2, 2, 2], 'outside the window the new commit triggers one re-sync that reuses the metadata');
console.log('  ✓ a commit pushed inside the window is synced after it');

// refresh=true bypasses the TTL.
await pack({ refresh: true });
assert.deepEqual([calls.metadata, calls.commits, calls.diffstat, calls.diff], [4, 3, 3, 3]);
console.log('  ✓ refresh=true bypasses the TTL');

// sync_my_open_prs: unchanged cached PRs cost no per-PR metadata request; the account UUID is fetched once.
for (let i = 0; i < 2; i++) {
  const res: any = await client.callTool({ name: 'sync_my_open_prs', arguments: { repository: 'acme/demo-repo' } });
  const body = JSON.parse(res.content[0].text);
  assert.deepEqual([body.total, body.unchanged, body.synced, body.failed], [1, 1, 0, 0]);
}
assert.deepEqual([calls.metadata, calls.commits, calls.diffstat, calls.diff], [4, 3, 3, 3], 'discovery data decides; no per-PR metadata request');
assert.equal(calls.user, 1, 'GET /user once per process for the same credentials');
assert.ok(readCurrent().freshness_checked_at, 'the discovery check is persisted too');
console.log('  ✓ sync_my_open_prs skips unchanged cached PRs without a metadata request; user UUID fetched once');

// The stamp never overwrites a pointer that moved to another revision.
const current = readCurrent();
const scope = { workspace: 'acme', repoSlug: 'demo-repo', prId: 7 };
assert.equal(RevisionWriter.recordFreshnessCheck(prDir, scope, { ...current, active_revision: 'rev_0000000_0000000' }, '2000-01-01T00:00:00.000Z'), false);
assert.equal(readCurrent().freshness_checked_at, current.freshness_checked_at);
assert.equal(RevisionWriter.recordFreshnessCheck(prDir, scope, current, '2030-01-01T00:00:00.000Z'), true);
assert.equal(readCurrent().freshness_checked_at, '2030-01-01T00:00:00.000Z');
console.log('  ✓ recordFreshnessCheck round-trips through zod and the secure writer and skips a moved pointer');

process.env.FRESHNESS_TTL_SECONDS = '0';
(ConfigManager as any).cached = null;
ConfigManager.loadBase();

// A state or draft change is a revision change even when neither commit changed.
prState = 'MERGED';
await pack();
assert.deepEqual([calls.metadata, calls.commits, calls.diffstat, calls.diff], [5, 4, 4, 4], 'state change triggers a validated sync');
prState = 'OPEN';
isDraft = true;
await pack();
assert.deepEqual([calls.metadata, calls.commits, calls.diffstat, calls.diff], [6, 5, 5, 5], 'draft change triggers a validated sync');
isDraft = false;
console.log('  ✓ state and draft changes trigger a sync even when commit hashes stay the same');

// Every PR-specific local data reader checks the head. Changed metadata syncs before its response;
// the subsequent unchanged reads do not request commits, diffstat, or diff.
sourceHash = 'dddddddddddd';
let beforeReader = { ...calls };
await client.callTool({ name: 'get_pr_sync_status', arguments: { pr_url: PR_URL } });
assert.deepEqual([calls.metadata, calls.commits, calls.diffstat, calls.diff], [beforeReader.metadata + 1, beforeReader.commits + 1, beforeReader.diffstat + 1, beforeReader.diff + 1], 'sync status syncs a changed PR before returning');
for (const [name, args] of [
  ['search_pr_files', { pr_url: PR_URL }],
  ['get_pr_file_context', { pr_url: PR_URL, file_id: 'file_0001' }],
  ['get_pr_file_changes', { pr_url: PR_URL, file_id: 'file_0001' }],
  ['get_pr_comments', { pr_url: PR_URL }]
] as const) {
  beforeReader = { ...calls };
  const result: any = await client.callTool({ name, arguments: args });
  assert.ok(!result.isError, `${name}: ${result.content[0].text}`);
  assert.equal(calls.metadata, beforeReader.metadata + 1, `${name} checks PR freshness`);
  assert.deepEqual([calls.commits, calls.diffstat, calls.diff], [beforeReader.commits, beforeReader.diffstat, beforeReader.diff], `${name} reuses the unchanged local revision`);
}
console.log('  ✓ PR-specific local readers verify freshness and avoid unchanged diff downloads');

// A failed head check must not prevent an independent comments refresh; cached revision remains explicit.
metadataUnavailable = true;
const commentsBeforeOffline = calls.comments;
const offline = await pack();
assert.match(offline, /could not check Bitbucket for newer commits/);
assert.ok(calls.comments > commentsBeforeOffline, 'comment refresh is attempted independently of the PR-head check');
assert.match(offline, /Review note/);
metadataUnavailable = false;
console.log('  ✓ failed head checks retain the cached revision and still refresh comments');

await client.close();
