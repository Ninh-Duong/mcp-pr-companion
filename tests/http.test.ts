// fetchWithRetry: retries 429/5xx a bounded number of times, never retries other errors.
import assert from 'node:assert/strict';
import { fetchWithRetry } from '../src/core/bitbucket/http.ts';

let calls = 0;
let statuses: number[] = [];
globalThis.fetch = (async () => {
  const status = statuses[Math.min(calls++, statuses.length - 1)];
  return new Response('{}', { status, headers: { 'Retry-After': '0' } });
}) as typeof fetch;

const run = async (seq: number[]) => {
  calls = 0;
  statuses = seq;
  return (await fetchWithRetry('https://api.bitbucket.org/2.0/x', {})).status;
};

assert.equal(await run([429, 200]), 200);
assert.equal(calls, 2, '429 then 200: one retry');
assert.equal(await run([503, 503, 503, 503]), 503);
assert.equal(calls, 3, 'gives up after 2 retries');
assert.equal(await run([401]), 401);
assert.equal(calls, 1, '401 is never retried');
console.log('  ✓ fetchWithRetry retries 429/5xx at most twice and leaves other statuses alone');

// No Retry-After header: back off (regression: Number(null) === 0 retried instantly)
globalThis.fetch = (async () => new Response('{}', { status: calls++ === 0 ? 503 : 200 })) as typeof fetch;
calls = 0;
const started = Date.now();
assert.equal((await fetchWithRetry('https://api.bitbucket.org/2.0/x', {})).status, 200);
assert.ok(Date.now() - started >= 900, `waited ${Date.now() - started} ms`);
console.log('  ✓ without Retry-After the first retry waits the 1 s backoff');
