---
description: "Wave-parallel SpecKit task list for Plan 1 Review Remediation & Performance Optimization"
---

# Tasks: Plan 1 Review Remediation & Performance Optimization

**Input**: Design documents from `specs/001-plan1-optimization/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/mcp-tools.md`, `quickstart.md`

## Format: `[ID] [P?] [Story?] Description with file path`

- **[P]**: Parallelizable across disjoint files with no incomplete dependencies
- **[Story]**: User story traceability (`[US1]`–`[US5]`) per `spec.md`

---

## Phase 1: Setup & SpecKit Baseline

**Purpose**: Ensure SpecKit governance, baseline checks, and branch readiness before multi-agent Wave 1 launch

- [X] T001 Verify SpecKit structure and baseline `npx tsc -p tsconfig.test.json && npm test` pass in `.specify/memory/constitution.md` and `tests/run.mjs`

---

## Phase 2: Foundational / Wave 1 — Parallel Disjoint Sessions (`S1`, `S2`, `S3`, `S4`, `S5`)

**Purpose**: Five parallel workers (`workspace: "share"`) resolve core security, crypto, HTTP, write-path, and config/ops/test foundations before read-path and MCP tool layers build on them.

### S1 — Privacy Redaction & Pagination Warning Sanitization (`[US1]`)

> **TDD Gate**: Write failing tests in `tests/security.test.ts` and `tests/privacy.test.ts` first.

- [ ] T002 [P] [US1] Add `SEC-1` secret/keep-unchanged assertions and `SEC-6` 401 pagination warning redaction test in `tests/security.test.ts`
- [ ] T003 [P] [US1] Guard `Date.now` override in `try/finally` (`TEST-4`) in `tests/privacy.test.ts`
- [ ] T004 [US1] Fix `password_assignment`, add `generic_secret` (without EOL identifier trap) and `slack_webhook`, and skip redundant `.match()` when `!tracker` in `src/core/privacy/secret.scanner.ts`
- [ ] T005 [US1] Redact pagination error bodies before 100-char truncation and error messages in `src/core/bitbucket/pagination.ts` (depends on T004)
- [ ] T006 [US1] Confirm `src/core/analyzer/sensitive.file.policy.ts` keeps infra YAML files intact and record new categories in `agent-plans/plan1/sessions/S1-privacy-redaction.md`

### S2 — Crypto Scope Verification & AccessGate Deduplication (`[US1]`, `[US2]`)

> **TDD Gate**: Write failing tests in `tests/secure-file.test.ts` and `tests/access-gate.test.ts` first.

- [ ] T007 [P] [US1] Add scope-match (case-insensitive workspace/repo, strict `prId`), cross-PR/cross-repo mismatch rejection, and backward-compatible no-scope tests in `tests/secure-file.test.ts`
- [ ] T008 [P] [US2] Create concurrent `unlock` dedup and failed-unlock non-caching tests in `tests/access-gate.test.ts`
- [ ] T009 [US1] Add optional `expected?: SecureScope` verification (`sameScope`, throwing `DECRYPT_FAILED`) and `// ponytail:` upgrade comment to `decryptBuffer` and `readSecure` in `src/core/storage/secure-file.ts` (depends on T007)
- [ ] T010 [US2] Deduplicate concurrent `unlock` promises via `pending` Map and clear `pending` in `lockAll()` in `src/core/auth/access-gate.ts` (depends on T008)
- [ ] T011 [US1] Document repository-UUID threat model limits and scope verification in `docs/ENCRYPTION.md` and handoff notes in `agent-plans/plan1/sessions/S2-crypto-scope-and-gate.md`

### S3 — Bitbucket HTTP Resilience, `pagelen=100` & Streaming Diff Cap (`[US2]`)

> **TDD Gate**: Write failing tests in `tests/http.test.ts` first.

- [ ] T012 [P] [US2] Add transient network retry, abort no-retry, retry limit, `Content-Length`/stream diff cap (`MAX_DIFF_BYTES`), `pagelen=100`, partial coverage, and `timing.sleep` tests in `tests/http.test.ts`
- [ ] T013 [US2] Retry `ECONNRESET`/`ETIMEDOUT`/`ECONNREFUSED`/`EAI_AGAIN`/`UND_ERR_SOCKET`/`UND_ERR_CONNECT_TIMEOUT` (never `TimeoutError` or aborted signal) and export `timing = { sleep }` seam in `src/core/bitbucket/http.ts` (depends on T012)
- [ ] T014 [US2] Add `repoUrl` helper, `pagelen=100` on commits/diffstat, and `MAX_DIFF_BYTES = 20 * 1024 * 1024` line-boundary streaming cap returning `{ text, truncated }` in `src/core/bitbucket/bitbucket.client.ts` (depends on T013)
- [ ] T015 [US2] Handle `{ text, truncated }` with truncation warning and `coverage.diff = 'partial'` in `src/core/bitbucket/bitbucket.collector.ts` and record handoff notes in `agent-plans/plan1/sessions/S3-bitbucket-http.md` (depends on T014)

### S4 — In-Memory Validation, Fewer `fsync`s & Writer Options Object (`[US1]`, `[US2]`)

> **TDD Gate**: Write failing tests in `tests/integrity.test.ts` and `tests/atomic_write.test.ts` first.

- [ ] T016 [P] [US1] Add absolute-path error check, `validateData` vs `validate` parity, duplicate id, and missing `important_file_id` tests in `tests/integrity.test.ts`
- [ ] T017 [P] [US2] Add zero-`RevisionValidator.validate` spy test and `fs.fsyncSync <= 12` (10-file PR) assertion plus `WriteRevisionInput` caller updates in `tests/atomic_write.test.ts` and `tests/unit.test.ts`
- [ ] T018 [US1] Remove absolute staging paths from errors and split `RevisionValidator` into pure `validateData(data: RevisionData)` + disk `validate(dir)` in `src/core/output/revision.validator.ts` (depends on T016)
- [ ] T019 [US2] Add `{ fsync = true } = {}` option to `AtomicWriter.writeFileSync` in `src/core/storage/atomic.writer.ts`
- [ ] T020 [US2] Convert `RevisionWriter.writeRevision` to `WriteRevisionInput`, run `validateDataOrThrow` pre-write, use `writeStaged` + `fsyncDir` for staging and `files/<id>.md`, keep `current.json` fsynced, and update call site in `src/core/output/revision.writer.ts` and `src/core/storage/data.store.ts` (depends on T018, T019) and update `agent-plans/plan1/sessions/S4-write-path.md`

### S5 — Config Centralization, Log Retention, Test Runner & Auth/Generation Coverage (`[US4]`)

> **TDD Gate**: Write new `tests/logging.test.ts`, `tests/auth.test.ts`, `tests/generation.test.ts` first.

- [ ] T021 [P] [US4] Create `LOG_RETENTION_DAYS` pruning and `Logger.debug` config-path tests in `tests/logging.test.ts`
- [ ] T022 [P] [US4] Create `AuthService` + `CapabilityProbe` scope/401/403/`ALLOWED_EMAILS` tests in `tests/auth.test.ts`
- [ ] T023 [P] [US4] Create `GenerationManager` 2-PR batch + 500 error redaction tests in `tests/generation.test.ts`
- [ ] T024 [US4] Add `debug` (`boolean`, default `false`) and `log_retention_days` (`int >= 0`, default `14`) to `src/config/config.schema.ts`, `src/config/config.manager.ts`, `.env.example`, and `README.md` (config table + split `PRIVACY_*` rows)
- [ ] T025 [US4] Route `Logger.debug` via cached `ConfigManager.loadBase().debug` in `src/utils/logger.ts`, add `FileLogger.pruneOldDays` in `src/core/logging/file.logger.ts`, confirm `src/core/logging/run-summary.ts`, and redact `jobState.error` via `SecretScanner` in `src/core/generation/generation.job.ts` (depends on T021, T024)
- [ ] T026 [US4] Add `"typecheck": "tsc --noEmit -p tsconfig.test.json"` in `package.json`, run full-suite non-bail parallelized `tests/run.mjs` (preserving `✓ N test files passed`), convert `tests/benchmark.test.ts` & `tests/golden.test.ts` to `node:assert/strict`, wrap `Date.now` in `tests/freshness.test.ts`, fix `tests/stdio.test.ts` comment, and test/enable `npm ci --ignore-scripts` in `bin/cli.js` and record status in `agent-plans/plan1/sessions/S5-config-ops-tests.md`

**Checkpoint — Wave 1 Merge & Gate**: Merge `S1`–`S5` in order; verify `npx tsc --noEmit`, `npm run typecheck`, and `npm test` pass cleanly.

---

## Phase 3: Wave 2 — Read Path Performance & Scope Binding (`S6`, `[US1]`, `[US2]`)

**Goal**: Single active-revision resolution per MCP call, `O(F)` re-sync patch diffing, byte-identical array patch building, and scope-checked reads across `OutputReader`.

**Independent Test**: `tests/read-path.test.ts` + `tests/server.test.ts` verify `<= 3` / `<= 4` decrypts per file read, `<= 52` reads on 50-file re-sync, cross-PR scope rejection, and byte-identical patch output.

> **TDD Gate**: Write failing tests in `tests/read-path.test.ts` first.

- [ ] T027 [US2] Create read-count, O(F) re-sync, cross-PR wrong-scope, and byte-identical patch tests in `tests/read-path.test.ts`
- [ ] T028 [US1] Thread `scope?: SecureScope` into `readText`/`readJson` (`readSecure(file, scope)`), pre-filter missing `current.json` before decrypt, compute `locationOptions()` once, fix `resolveRevisionDir(..., revisionId)`, and add low-level `readContextPack`/`readFilesSummary`/`readFileContext`/`revisionDir`/`readFileIndex`/`readFileChange` readers in `src/core/output/output.reader.ts` (depends on T009, T027)
- [ ] T029 [US2] Rewrite `diffAgainstActive` for single `getActiveRevision` + direct `readFileIndex`/`readText`, switch patch builder to `parts.push()` + `join('\n') + '\n'`, and push tag ids in-place in `src/core/storage/data.store.ts` (depends on T020, T028)
- [ ] T030 [US2] Return `{ pr, scope, active }` from `requireSynced` and `active` from `ensureFresh`, pass `active` to `OutputReader` low-level readers and `fetchComments`/`reviewThreadsSection` in `src/mcp/context.service.ts`, and update `OutputReader.readFileChange` spy in `tests/server.test.ts` (line 197) + `tests/pipeline.test.ts` if needed (depends on T028, T029) and fill `agent-plans/plan1/sessions/S6-read-path-perf.md`

**Checkpoint — Wave 2 Merge & Gate**: Merge `S6`; verify `npm run typecheck && npm test`.

---

## Phase 4: Wave 3 — Bounded MCP Tool APIs & Untrusted Content Isolation (`S7`, `[US3]`)

**Goal**: Bounded `offset`/`limit` on `list_my_open_prs`, 50-row unchanged cap on `sync_my_open_prs`, parallel non-caching MCP discovery, and `<untrusted_pr_content>` isolation across outputs.

**Independent Test**: `tests/server.test.ts` verifies 120-PR paging + deterministic sort, 80-PR `omitted_unchanged`, parallel multi-repo timestamps, empty `DiscoveryCache` on MCP calls, `<untrusted_pr_content>` tag escaping, and `< 1,500` char `INSTRUCTIONS`.

> **TDD Gate**: Add failing MCP client tests in `tests/server.test.ts` first.

- [ ] T031 [US3] Add paging, sorting, `omitted_unchanged`, parallel discovery timestamp, empty `DiscoveryCache`, `<untrusted_pr_content>` escaping, `content_trust`, and `INSTRUCTIONS` tests in `tests/server.test.ts`
- [ ] T032 [US3] Export `untrusted(source, text)` escaping `<\/?untrusted_pr_content` and wrap description, commits (`formatContextPack`), and diff (`formatFileDetail`) in `src/core/output/markdown.formatter.ts` (depends on T031)
- [ ] T033 [US3] Add `options: { cache?: boolean } = {}` to `discoverOpenPRsWithWarnings` guarding `DiscoveryCache.setPRs` in `src/core/discovery/pr-discovery.service.ts` (keep CLI `tests/discovery.test.ts` default behavior)
- [ ] T034 [US3] Extract `resolveTargets(repository?)`, parallelize repo discovery (`Promise.all` / `pLimit(3)` when `> 5`), pass `{ cache: false }`, page/sort `listMyOpenPRs` (`offset = 0`, `limit = 50`, max `200`), cap `unchanged` rows at `MAX_UNCHANGED_ROWS = 50` with `omitted_unchanged`, use in-place `.push()` for `byWhere`, wrap `reviewThreadsSection` (`comments`) & `reviewStatusSection` (`build_status`), and add `content_trust: 'untrusted'` to `getComments` in `src/mcp/context.service.ts` (depends on T032, T033)
- [ ] T035 [US3] Register `offset` (`min 0, default 0`) & `limit` (`min 1, max 200, default 50`) on `list_my_open_prs`, update tool descriptions + `INSTRUCTIONS` (`< 1500` chars), and update `AGENTS.md` §4, `README.md` tool table, `docs/HUB_INTEGRATION.md` §3, plus generate sibling handoff doc `specs/001-plan1-optimization/mcp-hub-contract-handoff.md` (`tests/stdio.test.ts` passes) in `src/mcp/tools.ts` and `agent-plans/plan1/sessions/S7-tool-api-and-untrusted.md` (depends on T034)

**Checkpoint — Wave 3 Merge & Gate**: Merge `S7`; verify `npm run typecheck && npm test`.

---

## Phase 5: Wave 4 — Split `PRContextService` & Dead Code Removal (`S8`, `[US5]`)

**Goal**: Pure refactor decomposing `src/mcp/context.service.ts` into cohesive modules under 250 lines each with shared text helpers and zero test edits.

**Independent Test**: `npm run typecheck && npm test` passes identically with `git diff --stat tests/` completely empty.

- [ ] T036 [P] [US5] Extract `errorText`, `cleanText`, `capText`, `sameCommit`, and `statusCommitHash` in `src/mcp/text.ts` (or shared `src/core/privacy/clean.ts` reused in `src/core/storage/data.store.ts`)
- [ ] T037 [P] [US5] Extract `sync` and `ensureFresh` helpers (`inFlight` Map) into `src/mcp/freshness.ts` (depends on T036)
- [ ] T038 [P] [US5] Extract `reviewStatusSection`, `reviewThreadsSection`, `fetchComments`, and `getComments` into `src/mcp/review-live.ts` (depends on T036)
- [ ] T039 [P] [US5] Extract `resolveTargets`, `discoverMyOpenPRs`, `listMyOpenPRs`, `syncMyOpenPRs`, `matchesDiscovery`, and `autoSync` into `src/mcp/my-prs.ts` (depends on T036, T037)
- [ ] T040 [US5] Slim `PRContextService` to static facade (`<= 250` lines/file across `src/mcp/*.ts`), remove `type Head = PRHead` and dead `DiscoveryCache.clear()` in `src/mcp/context.service.ts` and `src/core/discovery/discovery-cache.ts`, update `AGENTS.md` §3 code map, verify `git diff --stat tests/` is empty, and update `agent-plans/plan1/sessions/S8-context-service-split.md` (depends on T037, T038, T039)

**Checkpoint — Wave 4 Merge & Gate**: Merge `S8`; verify zero test edits and `npm run typecheck && npm test`.

---

## Phase 6: Wave 5 — Integration, Docs Sync & SpecKit Convergence (`S9`)

**Purpose**: Apply all session handoff notes, run full verification and invariant spot checks, and execute `/speckit-converge`.

- [ ] T041 Apply S1/S3/S4/S6/S8 handoff updates to `docs/ARCHITECTURE.md` and `docs/STANDARDS.md`
- [ ] T042 Update status tables in `agent-plans/plan1/README.md`, `agent-plans/plan1/sessions/S9-integration-verify.md`, and mark completed tasks in `specs/001-plan1-optimization/tasks.md`
- [ ] T043 Run full `npx tsc --noEmit`, `npm run typecheck`, `npm run build`, `npm test`, `node bin/cli.js check` (if configured), all 5 constitution invariant spot checks, and `/speckit-converge` audit against `spec.md` and `plan.md`

---

## Dependencies & Execution Order

```text
Phase 1 (Setup/SpecKit)
  └── Phase 2 / Wave 1: [S1 (T002-T006) || S2 (T007-T011) || S3 (T012-T015) || S4 (T016-T020) || S5 (T021-T026)]
        └── Phase 3 / Wave 2: S6 (T027-T030)  [depends on S2, S4, S5]
              └── Phase 4 / Wave 3: S7 (T031-T035)  [depends on S6]
                    └── Phase 5 / Wave 4: S8 (T036-T040)  [depends on S7]
                          └── Phase 6 / Wave 5: S9 + /speckit-converge (T041-T043)
```

## Notes

- Every Wave 1–4 author works in an isolated `swarm` `workspace: "share"` copy on its exclusive owned files, writing failing TDD tests before implementation and committing once verified by a swarm verifier.
- Do not modify `../mcp-hub` directly from this workspace; deliver `specs/001-plan1-optimization/mcp-hub-contract-handoff.md` for manual/separate-repo commit unless requested.
