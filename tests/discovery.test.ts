// PR discovery must follow Bitbucket's `next` links (it used to read only the first 50 PRs).
import assert from 'node:assert/strict';
import { PRDiscoveryService } from '../src/core/discovery/pr-discovery.service.ts';

const me = '{11111111-2222-3333-4444-555555555555}';
const pr = (id: number) => ({ id, title: `PR ${id}`, state: 'OPEN', author: { uuid: me }, source: { branch: { name: 'f' }, commit: { hash: 'a' } }, destination: { branch: { name: 'main' }, commit: { hash: 'b' } } });

const page2 = 'https://api.bitbucket.org/2.0/repositories/acme/demo/pullrequests?page=2';
globalThis.fetch = (async (input: string | URL) => {
  const body = String(input) === page2 ? { values: [pr(2)] } : { values: [pr(1)], next: page2 };
  return new Response(JSON.stringify(body), { status: 200 });
}) as typeof fetch;

const found = await PRDiscoveryService.discoverOpenPRs('dev@example.com', 'token', 'acme', 'demo', me);
assert.deepEqual(found.map(p => p.id).sort(), [1, 2]);
console.log('  ✓ PR discovery reads every page');

// A failing listing must be an error, not "you have no open PRs" (regression: HTTP 401/429 became total: 0).
globalThis.fetch = (async () => new Response('{"error":"rate limited"}', { status: 429, statusText: 'Too Many Requests', headers: { 'retry-after': '0' } })) as typeof fetch;
await assert.rejects(PRDiscoveryService.discoverOpenPRs('dev@example.com', 'token', 'acme', 'demo', me), /Could not list pull requests for acme\/demo: .*HTTP 429/);
globalThis.fetch = (async () => new Response(JSON.stringify({ values: [] }), { status: 200 })) as typeof fetch;
assert.deepEqual(await PRDiscoveryService.discoverOpenPRs('dev@example.com', 'token', 'acme', 'demo', me), []);
console.log('  ✓ a failed listing throws; a real empty listing returns []');
