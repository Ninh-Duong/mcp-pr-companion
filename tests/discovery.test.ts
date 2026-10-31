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

const requestedStates: string[] = [];
globalThis.fetch = (async (input: string | URL) => {
  const url = new URL(String(input));
  const state = url.searchParams.get('state') || '';
  requestedStates.push(state);
  const values = state === 'OPEN'
    ? [pr(10), { ...pr(11), draft: true }]
    : [{ ...pr(state === 'MERGED' ? 20 : 30), state }];
  return new Response(JSON.stringify({ values }), { status: 200 });
}) as typeof fetch;

const discovered = await PRDiscoveryService.discoverMyPRs('dev@example.com', 'token', 'acme', 'demo', me, ['OPEN', 'MERGED', 'DECLINED']);
assert.deepEqual(discovered.prs.map(p => [p.id, p.state]).sort((a, b) => Number(a[0]) - Number(b[0])), [
  [10, 'OPEN'], [11, 'OPEN'], [20, 'MERGED'], [30, 'DECLINED']
]);
assert.deepEqual(requestedStates.sort(), ['DECLINED', 'MERGED', 'OPEN']);
assert.equal(discovered.complete, true);
console.log('  ✓ PR discovery queries each requested Bitbucket state');

globalThis.fetch = (async (input: string | URL) => {
  const url = new URL(String(input));
  const pageNumber = Number(url.searchParams.get('page') || 1);
  const next = pageNumber < 52 ? `https://api.bitbucket.org/2.0/repositories/acme/demo/pullrequests?page=${pageNumber + 1}` : undefined;
  return new Response(JSON.stringify({ values: [pr(100 + pageNumber)], ...(next ? { next } : {}) }), { status: 200 });
}) as typeof fetch;
const fullHistory = await PRDiscoveryService.discoverMyPRs('dev@example.com', 'token', 'acme', 'demo', me, ['MERGED']);
assert.equal(fullHistory.prs.length, 52);
assert.equal(fullHistory.complete, true);
console.log('  ✓ state discovery continues beyond the previous 10-page cap');

globalThis.fetch = (async (input: string | URL) => {
  const url = new URL(String(input));
  if (url.searchParams.get('page') === '2') return new Response('page unavailable', { status: 400 });
  return new Response(JSON.stringify({ values: [pr(201)], next: 'https://api.bitbucket.org/2.0/repositories/acme/demo/pullrequests?page=2' }), { status: 200 });
}) as typeof fetch;
const partial = await PRDiscoveryService.discoverMyPRs('dev@example.com', 'token', 'acme', 'demo', me, ['DECLINED']);
assert.equal(partial.prs.length, 1);
assert.equal(partial.complete, false);
assert.ok(partial.warnings.length > 0);
console.log('  ✓ interrupted state pagination is reported as incomplete with partial results');

globalThis.fetch = (async () => new Response('{"error":"rate limited"}', {
  status: 429,
  statusText: 'Too Many Requests',
  headers: { 'retry-after': '0' }
})) as typeof fetch;
await assert.rejects(
  PRDiscoveryService.discoverOpenPRs('dev@example.com', 'token', 'acme', 'demo', me),
  /Could not list pull requests for acme\/demo: .*HTTP 429/
);
console.log('  ✓ a failed open-PR listing is not reported as an empty list');

let emptyListingCalls = 0;
globalThis.fetch = (async () => {
  emptyListingCalls++;
  return new Response(JSON.stringify({ values: [] }), { status: 200 });
}) as typeof fetch;
assert.deepEqual(await PRDiscoveryService.discoverOpenPRs('dev@example.com', 'token', 'acme', 'demo', me), []);
assert.equal(emptyListingCalls, 2, 'falls back to an unfiltered query, then client-side filters');
console.log('  ✓ a successful empty listing returns an empty list');

// The unfiltered fallback reads at most FALLBACK_MAX_PAGES pages of a large repository and labels the cut-off.
const fallbackPages: number[] = [];
const other = '{99999999-2222-3333-4444-555555555555}';
globalThis.fetch = (async (input: string | URL) => {
  const url = new URL(String(input));
  if (url.searchParams.get('q')) return new Response(JSON.stringify({ values: [] }), { status: 200 });
  const pageNumber = Number(url.searchParams.get('page') || 1);
  fallbackPages.push(pageNumber);
  const mine = pageNumber === 2 ? [pr(302)] : [];
  return new Response(JSON.stringify({
    values: [{ ...pr(400 + pageNumber), author: { uuid: other } }, ...mine],
    next: `https://api.bitbucket.org/2.0/repositories/acme/demo/pullrequests?page=${pageNumber + 1}`
  }), { status: 200 });
}) as typeof fetch;
const bounded = await PRDiscoveryService.discoverOpenPRsWithWarnings('dev@example.com', 'token', 'acme', 'demo', me);
assert.deepEqual(fallbackPages, [1, 2], 'fallback stops after FALLBACK_MAX_PAGES pages');
assert.equal(PRDiscoveryService.FALLBACK_MAX_PAGES, 2);
assert.deepEqual(bounded.prs.map(p => p.id), [302], 'partial fallback results are still returned, filtered to the author');
assert.equal(bounded.warnings.length, 1);
assert.match(bounded.warnings[0], /^Fallback listing incomplete: .*checked only the 2 newest pages/);
const boundedState = await PRDiscoveryService.discoverMyPRs('dev@example.com', 'token', 'acme', 'demo', me, ['MERGED']);
assert.equal(boundedState.complete, true, 'the authoritative author query was complete; the cut-off is a warning');
console.log('  ✓ the unfiltered fallback is bounded to 2 pages and labeled when cut off');
