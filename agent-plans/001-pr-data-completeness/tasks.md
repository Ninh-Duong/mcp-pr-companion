---
description: "Dependency-ordered implementation tasks for complete PR review data"
---

# Tasks: Complete PR Data for AI Agents

**Input**: `agent-plans/001-pr-data-completeness/spec.md` and design artifacts in the same directory.

**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/pr-comments.md`.

**Tests**: Required. Follow test-driven development: add one focused failing test, run it to confirm the expected failure, implement the smallest change, and rerun it.

**Organization**: Tasks map to user stories so each increment has a measurable acceptance check. Source-file tasks that share `src/mcp/context.service.ts` or `tests/server.test.ts` are serialized.

## Format: `[ID] [P?] [Story] Description`

- `[P]` marks tasks that touch independent files and can be done concurrently after dependencies are met.
- `[US1]` through `[US4]` map to the stories in `spec.md`.
- Every implementation task names exact repository paths.

## Phase 1: Setup and Baseline

**Purpose**: Confirm the isolated branch and capture the baseline before implementation.

- [x] T001 Initialize Spec Kit in the isolated worktree and preserve `AGENTS.md`, `CLAUDE.md`, and `.gitignore`.
- [x] T002 [P] Record repository invariants in `.specify/memory/constitution.md` without replacing detailed rules in `AGENTS.md`.
- [x] T003 [P] Create feature artifacts under `agent-plans/001-pr-data-completeness/` and point `.specify/feature.json` to that directory.
- [x] T004 Run baseline `npm test` and record result in `agent-plans/001-pr-data-completeness/quickstart.md`.

## Phase 2: Foundational Contracts and Storage Boundary

**Purpose**: Fix the versioned sidecar contract and access/encryption boundary before story implementation.

- [x] T005 [P] [US2] Add schema tests for review index, pointer, and comment records in `tests/live-review-snapshot.test.ts`; cover schema version 1, required metadata, optional author/location fields, and rejection of invalid records.
- [x] T006 [P] [US2] Add test fixtures/builders for complete and partial Bitbucket comment pagination in `tests/fixtures/` or the existing test-local fixture pattern, without storing real user data.
- [x] T007 [US2] Define Zod schemas for the version-1 review pointer, index, and comment records in `src/core/output/schema/live-review.v1.schema.ts`, matching `agent-plans/001-pr-data-completeness/data-model.md`.
- [x] T008 [US2] Implement encrypted read/write primitives and atomic snapshot publication in `src/core/output/live-review-snapshot.store.ts`; use only `readSecure`/`writeSecure`, validate before publishing `current.json` last, and preserve the prior pointer on any failure.
- [x] T009 [US2] Verify `AccessGate.unlock()` precedes all sidecar reads/writes at each MCP entry point in `src/mcp/context.service.ts` and `src/mcp/tools.ts`.

**Checkpoint**: Storage schema and atomic encrypted publication tests pass; no plaintext path exists.

## Phase 3: User Story 1 — Current PR Data Without Unchanged Revision Downloads (P1)

**Goal**: Every PR-specific local read checks the live PR head/state/draft and reuses an unchanged schema-v4 revision.

**Independent Test**: `tests/freshness.test.ts` proves unchanged metadata makes no commits/diffstat/diff requests; changed metadata completes sync before file data is returned; metadata failure is explicitly warned.

### Tests (write first)

- [x] T010 [P] [US1] Add freshness tests for unchanged revision reuse, changed revision sync, metadata failure fallback, and state/draft changes in `tests/freshness.test.ts`.
- [x] T011 [P] [US1] Add server-level cases proving every local PR reader is freshness-guarded and reports sync failures safely in `tests/server.test.ts`.

### Implementation

- [x] T012 [US1] Refactor freshness checking to use a zero-second default TTL in `src/config/config.schema.ts`, `src/config/config.manager.ts`, `.env.example`, and `README.md` while preserving explicit nonzero configuration compatibility.
- [x] T013 [US1] Make `ensureFresh()` reusable by all PR-specific local readers in `src/mcp/context.service.ts`; reuse the check's metadata response and avoid commit/diff collection when source/destination commits, state, and draft match.
- [x] T014 [US1] Guard `search_pr_files`, `get_pr_file_context`, `get_pr_file_changes`, `get_pr_sync_status`, and comment reads through the access gate and freshness path in `src/mcp/context.service.ts`.
- [x] T015 [US1] Ensure changed-head sync validates and publishes before returning local file data, and preserve the cached fallback with a clear warning if the live check fails in `src/mcp/context.service.ts`.
- [x] T016 [US1] Update freshness behavior and cache-write annotations, tool descriptions, and `INSTRUCTIONS` in `src/mcp/tools.ts`.

**Checkpoint**: Run focused `tests/freshness.test.ts` and relevant server cases; confirm no full diff sync for unchanged PRs.

## Phase 4: User Story 2 — Fresh Complete Review Snapshot (P1)

**Goal**: Refresh all comment pages on every report independently from revision commits and retain the previous complete snapshot on partial fetch.

**Independent Test**: With unchanged commits, a changed comment response updates encrypted sidecar. Injected pagination failure leaves old snapshot readable and reports warning and snapshot age.

### Tests (write first)

- [x] T017 [P] [US2] Add encrypted sidecar round-trip, authentication failure, access-gate, atomic pointer, malformed JSONL, and preservation-on-write-failure tests in `tests/live-review-snapshot.test.ts`.
- [x] T018 [US2] Add comment collection tests for complete pagination, incomplete pagination, partial page failure, empty initial fetch, preserving the last complete snapshot, and returning persisted refresh warnings on later list reads in `tests/server.test.ts`.
- [x] T019 [US2] Add context-pack tests proving comments are refreshed on every report even when commits are unchanged and freshness failure does not suppress an independent comment attempt in `tests/server.test.ts`.

### Implementation

- [x] T020 [US2] Implement snapshot validation, encrypted JSONL serialization, index warning metadata, encrypted last-attempt metadata, immutable snapshot IDs, pointer-last publication, and status-directory sidecar migration that preserves the newest complete snapshot in `src/core/output/live-review-snapshot.store.ts` and `src/core/output/revision.writer.ts`.
- [x] T021 [US2] Collect and sanitize all available non-deleted comment pages, preserving parent, author kind, created time, resolution, and inline location, in `src/core/bitbucket/bitbucket.collector.ts` or the existing comment collector module.
- [x] T022 [US2] Add report-time orchestration that always refreshes comments, binds the snapshot to the checked source commit, and on incomplete fetch serves the previous complete snapshot with sanitized warning and age in `src/mcp/context.service.ts`.
- [x] T023 [US2] Add first-fetch incomplete response semantics so available rows are explicitly marked incomplete and never represented as the complete review in `src/mcp/context.service.ts`.
- [x] T024 [US2] Keep approvals and build statuses out of sidecar schema and persistence; retain their existing live-only context-pack behavior in `src/mcp/context.service.ts` and `src/core/output/schema/live-review.v1.schema.ts`.

**Checkpoint**: Sidecar bytes are encrypted; partial collection cannot move the current pointer; report-time comments refresh independently of revision sync.

## Phase 5: User Story 3 — Bounded Retrieval of Full Sanitized Comment Text (P2)

**Goal**: List pages expose preview metadata and agents can retrieve every sanitized character through bounded comment detail pages.

**Independent Test**: Concatenating every `get_pr_comment` text page equals the full sanitized stored body with no gaps or repeats.

### Tests (write first)

- [x] T025 [P] [US3] Add list pagination and preview continuation tests for long and empty comment bodies in `tests/server.test.ts`.
- [x] T026 [P] [US3] Add detail pagination tests for first/middle/final pages, invalid offsets, unknown IDs, malformed IDs, and max-char bounds in `tests/server.test.ts`.

### Implementation

- [x] T027 [US3] Read review records from the encrypted snapshot and implement `get_pr_comments` list paging plus `text_total_chars`/`text_next_offset` in `src/mcp/context.service.ts`.
- [x] T028 [US3] Implement the bounded `get_pr_comment` detail method in `src/mcp/context.service.ts` and register its Zod inputs/output in `src/mcp/tools.ts`.
- [x] T029 [US3] Ensure comment identifiers, paths, text, and errors use current sanitizers and actionable sanitized messages in `src/mcp/context.service.ts` and `src/mcp/tools.ts`.

**Checkpoint**: Full sanitized body is recoverable through bounded pages; no response exceeds its declared page limit.

## Phase 6: User Story 4 — Deployment-Controlled Author Attribution (P2)

**Goal**: Keep global author privacy default hidden while allowing this deployment to opt in to sanitized display names.

**Independent Test**: Run the same comment fixture under both `PRIVACY_REMOVE_AUTHOR=true` and `false`; name is absent/present respectively while `author_kind` remains.

### Tests (write first)

- [x] T030 [P] [US4] Add author privacy projection tests for missing/default/true/false settings and sanitized names in `tests/server.test.ts`.

### Implementation

- [x] T031 [US4] Persist only sanitized author display names when `PRIVACY_REMOVE_AUTHOR=false`; omit author otherwise while always retaining `author_kind` in `src/core/bitbucket/bitbucket.collector.ts` or comment projection module.
- [x] T032 [US4] Set `PRIVACY_REMOVE_AUTHOR=false` only in the intended mcp-hub child deployment configuration, after checking the mcp-hub child contract and config conventions; do not alter global default or print config secrets.
- [x] T033 [US4] Document privacy configuration in `.env.example`, `README.md`, `docs/ENCRYPTION.md`, and `docs/HUB_INTEGRATION.md` without exposing real names or values beyond the boolean setting.

**Checkpoint**: Default remains hidden; opted-in deployment includes only sanitized display names.

## Phase 7: Polish, Integration, and Acceptance

**Purpose**: Align public contracts, docs, storage guidance, and all acceptance checks.

- [x] T034 [P] Update `src/mcp/tools.ts` `INSTRUCTIONS`, tool descriptions and annotations for freshness, report-time snapshot writes, list paging, and `get_pr_comment`.
- [x] T035 [P] Update the README tool table, configuration table, and report workflow in `README.md`.
- [x] T036 [P] Update encrypted layout and freshness pipeline documentation in `docs/ARCHITECTURE.md` and `docs/ENCRYPTION.md`.
- [x] T037 [P] Update `docs/HUB_INTEGRATION.md` and `../mcp-hub/docs/mcps/mcp-pr-companion.md` for the new tool contract, annotations, workflow, and privacy behavior; update any Hub allowlist only if required by its documented compatibility process.
- [x] T038 [P] Add acceptance checklist results to `agent-plans/001-pr-data-completeness/checklists/storage-security.md` and `agent-plans/001-pr-data-completeness/checklists/mcp-contract.md`.
- [x] T039 Run full `npm test`, `npx tsc --noEmit`, and `node bin/cli.js check`; record outputs and any environment limitation in `agent-plans/001-pr-data-completeness/quickstart.md`.
- [x] T040 Run `speckit-converge` against the implementation and append any remaining work to this file before resolving it.
- [x] T041 Run `speckit-analyze` across `spec.md`, `plan.md`, and `tasks.md`, then resolve inconsistencies in the feature artifacts.
- [x] T042 Complete final security/privacy and code review for the feature and record findings/resolutions in `agent-plans/001-pr-data-completeness/checklists/`.

## Dependencies and Execution Order

```text
T001-T004 (complete)
        |
T005-T009 (sidecar contract and storage foundation)
        |
T010-T016 (US1 freshness) ---- prerequisite for report integration
        |
T017-T024 (US2 independent review snapshots)
        |
T025-T029 (US3 comment paging) ---- T030-T033 (US4 author projection can overlap after schema fixed)
        \___________________________/
                      |
              T034-T042 integration and acceptance
```

- US1 and storage foundation are serialized before report orchestration because `src/mcp/context.service.ts` is shared.
- After T007 fixes the schema, T017 storage tests and T010 freshness tests can be developed in separate agents; neither may edit shared source files concurrently.
- US3 and US4 can proceed concurrently after T020-T022 stabilize the snapshot reader interface, provided US3 owns `src/mcp/tools.ts` and US4 does not touch it.
- Documentation updates can run in parallel after the tool contract is finalized. Keep `README.md` changes in one task to avoid overlap.
- Every implementation task uses a fresh implementer and a separate task reviewer; the coordinator resolves findings before advancing.

## Parallel Execution Examples

```text
After T007:
  Agent A: T017 (snapshot store tests in tests/live-review-snapshot.test.ts)
  Agent B: T010 (freshness tests in tests/freshness.test.ts)

After T020-T022:
  Agent A: T025-T029 (comment pages; owns tests/server.test.ts and src/mcp/tools.ts)
  Agent B: T030-T033 (author privacy projection/config/docs; avoid shared tool files)

After the MCP contract is fixed:
  Agent A: T034 + docs/HUB_INTEGRATION.md + Hub contract
  Agent B: T035 + README.md
  Agent C: T036 + storage documentation
```

## Implementation Strategy

1. Complete encrypted sidecar schema and storage tests first; do not add plaintext fixtures with real PR data.
2. Deliver the P1 freshness story and verify unchanged PRs avoid commit/diff requests.
3. Deliver the P1 report refresh story and verify complete snapshot atomicity and stale fallback.
4. Add P2 bounded comment retrieval and opt-in author attribution.
5. Update contracts/docs, run all required checks, converge tasks, analyze artifacts, then final-review.

**MVP**: US1 and US2 together. A report is not complete until the PR revision is current and the independent review snapshot is refreshed or its stale/incomplete state is explicit.
