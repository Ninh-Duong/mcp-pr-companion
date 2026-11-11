# S6: Read path performance (Wave 2, after S2 and S4 are merged)

**Goal:**
- Every MCP tool call resolves the active revision at most once.
- A re-sync reads each previous patch exactly once.
- Every encrypted read checks its PR scope.

**Findings:** PERF-1, PERF-2, PERF-3b, PERF-9, SEC-3 (integration).

**Owned files:**
- `src/core/output/output.reader.ts`
- `src/core/storage/data.store.ts`
- `src/mcp/context.service.ts`
- `tests/server.test.ts`
- `tests/pipeline.test.ts`
- `tests/freshness.test.ts` (only if a signature change forces it)
- new file: `tests/read-path.test.ts`

**Read-only references:**
- `src/core/storage/secure-file.ts`, which after S2 has `readSecure(file, expected?)`.
- `src/core/output/revision.writer.ts`, which after S4 has the `writeRevision(input)` options object.
- CLI callers of `OutputReader`. Grep `OutputReader.` in `src/cmd/` and `src/core/`.

**Branch:** `opt/S6-read-path`. Rebase it on the merged Wave 1 first.

**Rule:** the public static methods of `OutputReader` used by the CLI keep their signatures. Add new methods; do not break old ones.

## Tests to write first (`tests/read-path.test.ts`, reusing the setup of `tests/server.test.ts`)

Count decryptions with a spy: wrap `OutputReader.readText` (it is a static method, so replace it and restore it in `finally`).

1. **`get_pr_file_context` on a synced PR** (with the freshness TTL active, so no sync happens):
   - `readText` is called for at most `current.json`, `manifest.json` and `files/<id>.md`, so ≤ 3 times for a single status dir.
   - Before the fix the count is ≥ 4, because `requireSynced` and `getFileContext` each run `getActiveRevision`.
2. **`get_pr_file_changes`:** at most `current.json`, `manifest.json`, `change.json` and `patch.diff`, so ≤ 4 calls.
3. **`get_pr_context_pack` inside the TTL:** `getActiveRevision` is called once. Spy on it as well.
4. **Re-sync of a 50-file PR to a new revision** (`DataStore.saveRevision` twice with different source hashes):
   - The second save reads exactly 50 `patch.diff` files from the previous revision.
   - It reads `manifest.json` and `current.json` at most once each, not about 50 times.
5. **Wrong-scope file:** copy a `change.json` from PR 1 into PR 2's revision dir. `get_pr_file_changes` for PR 2 fails with an error matching `/Cannot decrypt/`. That is SEC-3 working end to end.
6. **Patch bytes are unchanged:** `patch.diff` written after the PERF-9 change equals a fixture captured before the change, with the same input diff. Capture the fixture first by running the old code once in the test setup, or hard-code a small expected patch.

## Logic

### SEC-3 integration (`output.reader.ts`)

`readText(file)` becomes `readText(file, scope?: SecureScope)`, calling `readSecure(file, scope)`. Every internal read passes `{ workspace, repoSlug, prId }`. `readJson` forwards it.

### PERF-1: resolve once

**New low-level readers** that take what the caller already has:
```ts
static readContextPack(active: ActiveRevisionResult, scope): string | null   // prDir/context.md
static readFilesSummary(active, scope): string | null
static readFileContext(active, scope, fileId): string | null                 // prDir/files/<id>.md
static revisionDir(active): string                                           // prDir/revisions/<active_revision>
static readFileIndex(revDir, scope): FileIndexEntryV4[]
static readFileChange(revDir, scope, fileId): { change; diffContent? } | null
```

- The old methods (`getContextPack`, `getFileContext`, `getFileIndex`, `getFileChange`, `getManifest`) become thin wrappers: `getActiveRevision` (or `resolveRevisionDir`) followed by the new reader.
- **`resolveRevisionDir` fix:** when `revisionId` is given, do not call `getActiveRevision`. Scan `getPRDirectories(...)` for `revisions/<revisionId>` directly.

**`context.service.ts` changes:**
- `requireSynced(prUrl)` returns `{ pr, scope, active }`.
- `getFileContext`, `getFileChange` and `searchPRFiles` use `active` with the new readers.
- `ensureFresh` adds `active?: ActiveRevisionResult` to its result:
  - **unchanged:** the `active` it already read.
  - **offline:** the same.
  - **synced:** after `sync()`, call `getActiveRevision` once and return that.
- `getContextPack` uses `ensureFresh().active`, so it no longer calls `OutputReader.getContextPack`/`getFilesSummary` with a fresh lookup. When `include_file_table` is set it reuses the same `active`.
- `fetchComments(pr, active?)` builds `idByPath` from `readFileIndex(revisionDir(active))` when `active` is given. Only `getComments` (the standalone tool) still looks it up, and only once.
- `reviewThreadsSection(pr, active)` passes it through.

### PERF-2: `diffAgainstActive` (`data.store.ts:299-318`)

```ts
const active = OutputReader.getActiveRevision(workspace, repoSlug, prId);
const previous = active?.current.active_revision;
if (!active || !previous || previous === newRevisionId) return {};
const scope = { workspace, repoSlug, prId };
const revDir = OutputReader.revisionDir(active);
const oldPatchByPath = new Map<string, string>();
for (const entry of OutputReader.readFileIndex(revDir, scope)) {
  oldPatchByPath.set(entry.path, OutputReader.readText(path.join(revDir, 'files', entry.id, 'patch.diff'), scope) ?? '');
}
```

- `entry.id` comes from our own encrypted index. Still run it through `OutputReader.normalizeFileId` to be safe.
- `saveRevision` already gets `getPRDirectories(...)` for the writer. Leave that.

### PERF-3b: cheaper `getActiveRevision`

- It already returns null for missing files through `readText`. Add a fast path: filter `getPRDirectories(...)` to dirs where `fs.existsSync(path.join(dir, 'current.json'))` **before** any decryption.
- If exactly one dir remains, skip the sort.
- `getConfiguredPathOptions()` calls `ConfigManager.loadBase()`. If that is not cached, compute `locationOptions()` once per `getActiveRevision` call, not once per helper.

### PERF-9: patch building (`data.store.ts:162-169`)

```ts
const parts: string[] = [headerLines.join('\n')];
for (const hunk of matchedDiff.hunks) {
  parts.push(hunk.header);
  for (const line of hunk.lines) parts.push((line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ') + line.content);
}
let patchDiff = parts.join('\n') + '\n';
```

The output must be byte-identical to today's, including the trailing newline and the case with no hunks: today that yields `headerLines.join('\n') + '\n'`. Test 6 guards this.

## Docs

- `docs/ARCHITECTURE.md`: one paragraph saying that the active revision is resolved once per tool call and reads are bound to the PR scope. Put it in the Handoff notes for S9.

## Definition of done

- The new tests pass and the whole suite passes, especially `server`, `freshness`, `status-path`, `integrity` and `pipeline`.
- `npx tsc --noEmit` is clean.

**Commit:** `perf(read): resolve the active revision once per call, read previous patches directly, scope-checked reads`

## Status / Handoff notes
_(filled by the agent)_
