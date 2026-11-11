# S8: Split `context.service.ts` (Wave 4, after S7 is merged)

**Goal:** a pure refactor. `PRContextService` currently mixes five responsibilities in about 500 lines. Split it into focused modules and remove duplication and dead code. **No behaviour change.**

**Findings:** ARCH-1, ARCH-dup2, ARCH-dead.

**Owned files:**
- `src/mcp/context.service.ts`
- new files in `src/mcp/`: `freshness.ts`, `review-live.ts`, `my-prs.ts`, `text.ts` (or whichever split you choose, within `src/mcp/`)
- `src/core/discovery/discovery-cache.ts`: dead `clear()` only.
- `src/core/storage/data.store.ts`: only to reuse the shared `cleanText` helper, if it moves to `src/core/privacy/`. Otherwise leave it.

**Read-only references:** `src/mcp/tools.ts`. It must not need changes: keep the `PRContextService.*` static API as a facade.

**Branch:** `opt/S8-split`

**Rule:** run the full test suite before you start and save the output. After the refactor, the same tests must pass **without editing any test file**. If a test reaches into a private static, keep a forwarding static on `PRContextService`.

## Target layout

| Module | Contents (moved as is) |
|---|---|
| `src/mcp/text.ts` | `errorText(err)`, `cleanText(text)`, `capText`, `sameCommit`, `statusCommitHash` |
| `src/mcp/freshness.ts` | `inFlight`, `sync`, `ensureFresh`, `checkedRecently`, `recordFreshnessCheck` |
| `src/mcp/review-live.ts` | `reviewStatusSection`, `reviewThreadsSection`, `fetchComments`, `getComments` |
| `src/mcp/my-prs.ts` | `resolveTargets`, `discoverMyOpenPRs`, `listMyOpenPRs`, `syncMyOpenPRs`, `matchesDiscovery`, `autoSync` |
| `src/mcp/context.service.ts` | `Page`, `FileFilters`, `page()`, `requireSynced`, `getContextPack`, `getFileContext`, `getFileChange`, `searchPRFiles`, `listSyncedPRs`, `getSyncStatus`, plus static forwarders for every moved public method (`sync`, `ensureFresh`, `getComments`, `listMyOpenPRs`, `syncMyOpenPRs`, `autoSync`) |

- Use plain exported functions in the new modules; module-level state such as `inFlight` becomes a module `const`. Do not create new classes with a single implementation (AGENTS.md §2).
- **Avoid import cycles.** `my-prs.ts` needs `sync`/`ensureFresh` from `freshness.ts`. `context.service.ts` imports from all of them. Nothing imports `context.service.ts` back.

## Logic

### ARCH-dup2: shared text helpers

```ts
export const errorText = (err: unknown) => SecretScanner.scanAndRedact(err instanceof Error ? err.message : String(err));
export const cleanText = (text: string, tracker?: RedactionTracker) => SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(text, tracker), tracker);
```

- Replace every `SecretScanner.scanAndRedact(err instanceof Error ? err.message : String(err))` in `src/mcp/` with `errorText(err)`. Grep `err instanceof Error ? err.message`.
- `reviewStatusSection` has a `reason` lambda that adds `PIISanitizer`. Use `cleanText(err instanceof Error ? err.message : String(err))` there, which keeps its current behaviour of PII and then secret.
- `data.store.ts:55` has a `clean` lambda with a tracker. Leave it, unless `cleanText` lives in `src/core/privacy/` (for example `src/core/privacy/clean.ts`). In that case reuse it there too. Pick one place, and do not duplicate it.

### ARCH-dead

- Remove `type Head = PRHead` and use `PRHead` directly.
- `DiscoveryCache.clear()`: grep the callers. If it only calls `clearAll()`, replace the callers with `clearAll()` and delete `clear()`. If tests call `clear()`, keep it; tests are read-only in this session.
- `OutputReader.getManifest` is used by `tests/status-path.test.ts`. Keep it.

## Verification

- `npx tsc --noEmit` is clean.
- `npm test` gives the same pass count as before, with zero edited test files: `git diff --stat tests/` is empty.
- `wc -l src/mcp/*.ts`: no file over about 250 lines.
- Grep: no `err instanceof Error ? err.message` is left in `src/mcp/`, except inside `errorText`.

## Docs

`AGENTS.md` §3 code map: the `src/mcp/` rows list the new modules. This session may edit that one row; it does not conflict with S7, which is merged already.

**Commit:** `refactor(mcp): split PRContextService into freshness, live review and my-PRs modules`

## Status / Handoff notes
_(filled by the agent)_
