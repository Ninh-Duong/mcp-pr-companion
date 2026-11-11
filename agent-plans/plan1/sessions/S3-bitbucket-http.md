# S3: Bitbucket HTTP layer (Wave 1)

**Goal:**
- Fewer round trips.
- Bounded memory for huge diffs.
- Resilience to transient network errors.
- No repeated URL building.

**Findings:** ARCH-3, PERF-5, PERF-6, PERF-8, TEST-5.

**Owned files:**
- `src/core/bitbucket/bitbucket.client.ts`
- `src/core/bitbucket/http.ts`
- `src/core/bitbucket/bitbucket.collector.ts`
- `tests/http.test.ts`

**Read-only references:**
- `src/core/bitbucket/pagination.ts`: S1 owns it.
- `src/core/bitbucket/bitbucket.types.ts`: `coverage.diff` already allows `'partial'`.
- `src/cmd/pr-detail.screen.ts`

**Branch:** `opt/S3-bitbucket-http`

**Invariant 2:** `http.ts` stays the only `fetch()` call site, and every request is a `GET`.

## Tests to write first (`tests/http.test.ts`, fake `globalThis.fetch`)

1. **Retry on network error.** The fake `fetch` first throws `Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } })` and then returns `new Response('{}', {status:200})`. `fetchWithRetry` resolves `ok` after 2 calls.
2. **No retry on abort.** When the caller's `AbortSignal` is already aborted, the call rejects without a retry (1 call).
3. **Retries are limited.** Three `ECONNRESET` errors in a row reject after 3 calls (1 attempt + 2 retries).
4. **Diff cap via `Content-Length`.** Use the injectable cap (see below) or a small cap. A response with `content-length` above the cap makes `getPRDiffText` return `{ text: '', truncated: true }` and cancels the body.
5. **Diff cap via stream.** With no `content-length` and a streamed body over the cap, the result has `truncated: true`, ends at a line boundary, and is no longer than the cap.
6. **`pagelen` on commits and diffstat.** The first URL requested by `getPRCommits` and by `getPRDiffstat` contains `pagelen=100`.
7. **Collector coverage.** With a truncated diff, `collect()` returns `coverage.diff === 'partial'` and a warning matching `/Diff larger than/`.

## Logic

### ARCH-3: URL helper (`bitbucket.client.ts`)

```ts
const API = 'https://api.bitbucket.org/2.0';
private repoUrl(workspace: string, repoSlug: string, suffix = ''): string {
  return `${API}/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}${suffix}`;
}
```

Replace all 8 inline URLs with `this.repoUrl(ws, repo, \`/pullrequests/${prId}/commits?pagelen=100\`)` and so on.

### PERF-5: `pagelen`

- Commits: `?pagelen=100`.
- Diffstat: `?pagelen=100`. Bitbucket allows up to 500 here, but 100 keeps pages small.
- Comments (100) and statuses (50) already set it; leave them.

### PERF-6: diff size cap

```ts
// ponytail: fixed cap; make it an env setting if a team needs bigger diffs.
export const MAX_DIFF_BYTES = 20 * 1024 * 1024;

async getPRDiffText(ws, repo, prId, options = {}, maxBytes = MAX_DIFF_BYTES): Promise<{ text: string; truncated: boolean }> {
  const url = this.repoUrl(ws, repo, `/pullrequests/${prId}/diff`);
  try {
    const res = await fetchWithRetry(url, { ...this.headers, Accept: 'text/plain' }, { timeoutMs: options.timeoutMs || 45000, signal: options.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) { await res.body?.cancel(); return { text: '', truncated: true }; }
    if (!res.body) return { text: await res.text(), truncated: false };
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = []; let size = 0; let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > maxBytes) { chunks.push(value.subarray(0, maxBytes - size)); truncated = true; await reader.cancel(); break; }
      chunks.push(value); size += value.byteLength;
    }
    let text = Buffer.concat(chunks).toString('utf-8');
    if (truncated) text = text.slice(0, text.lastIndexOf('\n') + 1); // never cut a line (or a UTF-8 char) in half
    return { text, truncated };
  } catch (err: any) {
    throw new Error(`Failed to download PR diff: ${SecretScanner.scanAndRedact(err.message || String(err))}`);
  }
}
```

**Collector change** (`bitbucket.collector.ts:140-146`):

```ts
this.client.getPRDiffText(workspace, repoSlug, prId, options).then(
  ({ text, truncated }) => {
    if (truncated) warnings.push(`Diff larger than ${MAX_DIFF_BYTES / 1024 / 1024} MB: truncated; some files have no patch.`);
    return { text, coverage: (truncated ? 'partial' : 'complete') as 'complete' | 'partial' | 'failed' };
  },
  …
)
```

Fix the type of `diffCoverage` so it includes `'partial'`. Check that `RawPRRevision.coverage.diff` accepts it; it does.

**Other callers:** grep `getPRDiffText`. Today only the collector calls it. If `src/cmd/` calls it, add a Handoff note and use `.text` there.

### PERF-8: retry on network errors (`http.ts`)

```ts
const RETRY_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EAI_AGAIN', 'UND_ERR_SOCKET', 'UND_ERR_CONNECT_TIMEOUT']);
const isTransient = (err: any) => RETRY_CODES.has(err?.cause?.code ?? err?.code);

export async function fetchWithRetry(url, headers, options = {}) {
  for (let attempt = 0; ; attempt++) {
    const signal = AbortSignal.timeout(options.timeoutMs || 30000);
    let res: Response;
    try {
      res = await fetch(url, { headers, signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal });
    } catch (err) {
      if (options.signal?.aborted || !isTransient(err) || attempt >= BACKOFF_MS.length) throw err;
      await sleep(BACKOFF_MS[attempt]);
      continue;
    }
    if (!RETRY_STATUS.has(res.status) || attempt >= BACKOFF_MS.length) return res;
    await res.body?.cancel();
    await sleep(retryDelay(res, attempt));
  }
}
```

- Do **not** retry on our own per-attempt timeout (`TimeoutError`). That doubles the wait for a slow PR, and the timeout already bounds the cost. Retrying only on the network codes above is enough.
- Update the doc comment at the top of the file.

### TEST-5: fast tests

- Let tests avoid real sleeps. Export a small seam such as `export const timing = { sleep }`, and have `fetchWithRetry` call `timing.sleep(...)` so tests can replace it. Or use `Retry-After: 0` in the tests.
- Remove the `>= 900 ms` assertion in `tests/http.test.ts:29-31`, or keep it with the seam measuring the requested delay instead of wall time.

## Docs

- `docs/ARCHITECTURE.md` (collector section): mention the 20 MB diff cap and partial diff coverage. S3 does not own that file: put the line in the Handoff notes for S9.
- README: no change.

## Definition of done

- The new tests pass and `tests/server.test.ts` still passes (its fake fetch serves `/diff` as text).
- `npx tsc --noEmit` is clean and `npm test` passes.

**Commit:** `perf(bitbucket): cap diff size, page commits/diffstat at 100, retry transient network errors`

## Status / Handoff notes
_(filled by the agent)_
