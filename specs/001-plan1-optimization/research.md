# Research & Codebase Audit: Plan 1 Optimization

**Target Commit**: `9ef1cbc` | **Date**: 2026-11-12

## 1. Verified Findings & Corrections vs. Draft Sessions

### Catch 1 — `SecretScanner` `generic_secret_assignment` Lookahead Bug (`S1`)
- **Decision**: Omit the draft's `(?![A-Za-z_$][\w$.]*\s*[;),]?\s*$)` EOL identifier lookahead in `S1-privacy-redaction.md`.
- **Rationale**: In `S1`, two mandatory test inputs (`+  token: abcdefghijklmnop1234` and `+JWT_SECRET=abcdefghijklmnopqrstuvwxyz`) have pure alphanumeric values ending at EOL. The draft EOL lookahead matches those values and suppresses redaction. Using `(?![A-Za-z_$][\w$]*\s*\()` (skips `+const token = getToken();`) plus `(?!(?:string|number|boolean|undefined|null|true|false)\b)` (skips TypeScript type annotations such as `password_hash: string;`) passes every redaction and preservation test case cleanly.
- **Extra Performance**: When `SecretScanner.scanAndRedact(content, tracker?)` is called without `tracker` (the common path in `pagination.ts`, `logger.ts`, `tools.ts`, `context.service.ts`), skip `sanitized.match(item.regex)` before `sanitized.replace(...)` so V8 performs a single pass instead of two scans per pattern across multi-MB strings.

### Catch 2 — `tests/server.test.ts:197` Spy on `OutputReader.getFileChange` (`S6`)
- **Decision**: Update `tests/server.test.ts:197` in Wave 2 (`S6`) when `PRContextService.getFileChange` switches from `OutputReader.getFileChange(...)` to `OutputReader.readFileChange(revDir, scope, fileId)`.
- **Rationale**: Line 199 stubs `OutputReader.getFileChange` to return 51 symbols to test `symbols_total` capping. Updating the spy to `OutputReader.readFileChange` preserves the test contract.

### Catch 3 — `SEC-5` Dependency Install-Script Audit (`S5`)
- **Finding**: Auditing `package-lock.json` for `"hasInstallScript": true` finds exactly two packages, both `dev: true`: `esbuild@0.28.1` and `fsevents@2.3.3`. Zero production dependencies declare install scripts.
- **Verification Plan**: `S5` will run `npm ci --ignore-scripts` in a temporary directory copy, verify `npm run build` and `npm test` (`tsx`) succeed without `esbuild`'s verification script, and then enable `--ignore-scripts` in `bin/cli.js` (or document if platform binary verification fails).

### Catch 4 — `getPRDiffText` Callers (`S3`)
- **Finding**: Searching `getPRDiffText` across `src/` and `tests/` confirms `BitbucketCollector.collect` (`src/core/bitbucket/bitbucket.collector.ts:140`) is the only caller (`src/cmd/` does not call it). Changing the return type to `Promise<{ text: string; truncated: boolean }>` breaks no external caller.

### Catch 5 — `GenerationJob.executeJob` Error Redaction (`S5`)
- **Finding**: `src/core/generation/generation.job.ts:67` sets `jobState.error = err.message || String(err)` directly. While `FileLogger` runs `LogRedactor`, sanitizing `jobState.error` via `SecretScanner.scanAndRedact(...)` ensures `onProgress` payloads and caller results also obey Invariant 3 when upstream errors fail outside `collect()`.

### Catch 6 — `files/<id>.md` Staged Flush & Test Parallelism (`S4`, `S5`, `S6`)
- **Decision**:
  1. Promote `S4`'s optional `writeStaged` + `fsyncDir(tmpFilesDir)` for `files/<id>.md` to required, cutting total `fsyncSync` calls per revision from `3F + 8` down to a constant `~6` (plus directory flushes on POSIX; NTFS journaling handles Windows).
  2. Replace `[...(filesByTag.get(t) ?? []), fileIdStr]` (`data.store.ts:133`) and `[...(byWhere.get(where) ?? []), comment]` (`context.service.ts:302`) with in-place `.push()` to avoid O(N²) array cloning.
  3. Run `tests/run.mjs` with bounded async concurrency (e.g., `4` isolated temp `cwd` processes, buffering per-file logs, supporting `--serial` and `--bail`) to speed up CI/dev feedback while preserving `✓ N test files passed`.

## 2. Alternatives Considered

- **Path-Bound AAD (`PRC1` header `v: 2`)**: Rejected for Plan 1 because `PRC1` and Schema v4 on-disk compatibility are frozen (`AGENTS.md` §1 Invariant 11). Scope verification (`workspace`, `repoSlug`, `prId`) closes cross-PR and cross-repo substitution within `v: 1`.
- **Whole-file exclusion in `SensitiveFilePolicy` for `docker-compose.yml` / k8s YAML**: Rejected because reviewers need to inspect infrastructure diffs; regex redaction in `SecretScanner` protects secrets inside them.
