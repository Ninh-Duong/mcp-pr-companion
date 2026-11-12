# S4: Revision write path (Wave 1)

**Goal:**
- A cheaper sync: validate objects in memory instead of decrypting what was just written, with fewer `fsync`s.
- A readable writer API: an options object instead of 14 positional parameters.
- No absolute paths in errors.

**Findings:** INV-3a, ARCH-2, PERF-3, PERF-4.

**Owned files:**
- `src/core/output/revision.writer.ts`
- `src/core/output/revision.validator.ts`
- `src/core/storage/atomic.writer.ts`
- `tests/integrity.test.ts`
- `tests/atomic_write.test.ts`
- `tests/unit.test.ts`: only its `writeRevision(` call at about line 102.
- `src/core/storage/data.store.ts`: **only** the `RevisionWriter.writeRevision(...)` call at lines 272-287. S6 owns the rest of the file in Wave 2.

**Read-only references:**
- `src/core/output/schema/*.v4.schema.ts`
- `src/core/storage/secure-file.ts`: S2 owns it.
- AGENTS.md invariants 5 and 7

**Branch:** `opt/S4-write-path`

**Invariant 5 stays:** stage, validate, rename, write the top-level pack, then write `current.json` **last**.

**Invariant 7 stays:** same file names and same JSON content.

## Tests to write first

1. **INV-3a** (`tests/integrity.test.ts`): `RevisionValidator.validate(tmpDir)` on an empty temp dir returns errors. `errors.join()` must not contain `path.resolve(tmpDir)` or any drive or root prefix, but must still name `manifest.json`.
2. **`validateData` matches `validate`** (`tests/integrity.test.ts`):
   - Build the same objects that `atomic_write.test.ts` writes, and assert `RevisionValidator.validateData(...)` returns `valid: true`.
   - Corrupt `total_additions`: both `validateData` and `validate(dir)` report the same error text.
   - A duplicate file id is reported.
   - An `important_file_id` missing from the index is reported.
3. **No re-read after write** (`tests/atomic_write.test.ts`): spy on `RevisionValidator.validate` (replace the static method and count calls). One `writeRevision` call, with no previous dirs, makes `validate` run 0 times and `validateData` run once.
4. **Fewer fsyncs** (`tests/atomic_write.test.ts`): spy on `fs.fsyncSync`. For a revision with 10 files, the count is ≤ 12: one per directory, plus `current.json` and the top-level files. Before the fix it is ≥ 28. Keep the bound loose; the point is that per-file fsync in staging is gone.
5. **Existing tests** in `atomic_write.test.ts`, `unit.test.ts` and `status-path.test.ts` still pass after switching to the options object.

## Logic

### INV-3a: `revision.validator.ts`

- Lines 28-31: `errors.push('Missing manifest.json')` and the same for the other three files.
- Check every other `errors.push`/`warnings.push`: none may print `resolvedStagingDir` or an absolute path. `entry.detail_ref` and `fileChange.patch_ref` are relative already, so keep them.
- Zod messages (`err.message`) contain JSON paths, not file paths, so they are fine.

### PERF-3: in-memory validation

Split `validate(dir)` into a disk loader plus a pure checker:

```ts
export interface RevisionData {
  manifest: unknown;            // parsed JSON
  coverage: unknown;
  indexLines: string[];         // raw JSONL lines
  changes: Map<string, { change: unknown; patchExists: boolean }>; // keyed by detail_ref
  fileDirs: string[];           // names under files/
}

static validateData(data: RevisionData): ValidationResult { /* steps 2–6 of today's validate(), with no fs access */ }

static validate(stagingDir: string): ValidationResult {
  // step 1 (existence) → read+decrypt into RevisionData → return validateData(data)
}
```

- Path-traversal checks for `detail_ref`/`patch_ref` stay inside `validateData`. Use `path.posix.normalize` on the relative ref and reject `..` or an absolute path. Do not resolve against a directory.
- `writeRevision` builds `RevisionData` from what it is about to write: `fullManifest`, `coverageData`, `fileEntries.map(JSON.stringify)`, and `fileChangesMap`, with `patchExists: true`.
- Call `validateDataOrThrow` **before** writing anything to staging. A failing revision then never touches disk, which keeps invariant 5.
- After the writes, a cheap existence check (`fs.existsSync` for the 4 top files) guards against a silent write failure.
- `migratePreviousDirectory` keeps calling `validateOrThrow(dir)`, the disk version, for data that was written earlier.

### ARCH-2: options object

```ts
export interface WriteRevisionInput {
  workspace: string; repoSlug: string; prId: number;
  sourceHash: string; destinationHash: string;
  manifestData: Omit<PRManifestV4, 'schema_version'>;
  fileEntries: FileIndexEntryV4[];
  fileChanges: Map<string, { change: FileChangeV4; diffContent: string }>;
  commitsJsonl: string[];
  coverage: PRCoverageV4;
  company?: string; root?: string; status?: PRStorageStatus;
  previousPrDirs?: string[];
}
static writeRevision(input: WriteRevisionInput): { revisionId; manifest; prDir; revisionDir }
```

Update the three callers:
- `data.store.ts:272`
- `tests/atomic_write.test.ts:22,112`
- `tests/unit.test.ts:102`

Grep `writeRevision(` to be sure there are no others.

### PERF-4: fewer fsyncs (`atomic.writer.ts`, `revision.writer.ts`)

1. **Writer option.** `AtomicWriter.writeFileSync(file, data, { fsync = true } = {})`. When `fsync` is false, skip the `fsyncSync` on the temp file but keep the temp-then-rename step.
2. **Plumbing.** `writeSecure` lives in `secure-file.ts`, which S2 owns. Do not change it. Instead, add an internal helper in `revision.writer.ts`:
   ```ts
   const writeStaged = (file: string, text: string, scope: SecureScope) =>
     AtomicWriter.writeFileSync(file, encryptText(text, scope), { fsync: false });
   ```
   `encryptText` is already exported, so this calls only the public encryption function and still respects invariant 11.
3. **Staging writes.** Inside `tmpRevDir`, write `manifest.json`, `files.index.jsonl`, `commits.jsonl`, `coverage.json`, each `change.json` and each `patch.diff` with `writeStaged`.
4. **Flush staging before the rename.** Fsync each written directory once, before `fs.renameSync(tmpRevDir, targetRevDir)`:
   ```ts
   const fsyncDir = (dir: string) => { try { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch { /* Windows cannot fsync a directory */ } };
   ```
   On Windows, `fs.openSync(dir)` throws `EISDIR`/`EPERM`, which is fine: NTFS metadata is journaled.
   Add: `// ponytail: on Windows the staged files rely on NTFS journaling, not an explicit flush; good enough for a re-creatable cache.`
5. **Top-level pack.** `files/<id>.md`, `context.md`, `files.md`, `actions.md` and `manifest.json` stay on `writeSecure`, with fsync. Optional: `files/<id>.md` can use `writeStaged` too, plus one `fsyncDir(tmpFilesDir)` before its rename.
6. **`current.json`** always uses `writeSecure` with fsync. It is the commit point.

### Optional (only if trivial)

The `PERF-9` patch-building change lives in `data.store.ts`, which S6 owns. Do not touch it.

## Docs

- `docs/ARCHITECTURE.md` (atomicity section): validation now runs on the objects before writing, staged files are flushed per directory, and `current.json` is still the fsynced commit point. Put the text in the Handoff notes for S9.

## Definition of done

- The new tests pass, and `atomic_write`, `integrity`, `contract`, `status-path`, `server` and `pipeline` pass.
- `npx tsc --noEmit` is clean and `npm test` passes.

**Commit:** `perf(storage): validate revisions in memory, flush staging once, writer options object`

## Status / Handoff notes
_(filled by the agent)_
