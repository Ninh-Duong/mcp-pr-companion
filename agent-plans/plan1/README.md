# Plan 1: fix the review findings and optimize mcp-pr-companion

Created 2026-11-12. Each session below is a self-contained brief for one AI coding agent. Read in this order:

1. `../../AGENTS.md`: the repository's operating manual. Its 11 invariants override anything here.
2. [00-discussion.md](00-discussion.md): why this plan exists and the decisions already made.
3. [01-findings.md](01-findings.md): every weakness, with an ID, evidence, severity and owning session.
4. Your session file under [sessions/](sessions/).

## Sessions and waves

Sessions in the same wave own disjoint files and can run in parallel. A later wave starts from the merged result of the earlier ones.

| Wave | Session | Topic | Depends on |
|---|---|---|---|
| 1 | [S1](sessions/S1-privacy-redaction.md) | Secret redaction gaps, unsanitized pagination warnings | none |
| 1 | [S2](sessions/S2-crypto-scope-and-gate.md) | `readSecure` scope check, AccessGate in-flight dedup, ENCRYPTION.md threat model | none |
| 1 | [S3](sessions/S3-bitbucket-http.md) | Bitbucket client: URL helper, `pagelen`, diff size cap, network-error retry | none |
| 1 | [S4](sessions/S4-write-path.md) | Revision writer: options object, in-memory validation, fewer fsyncs, no absolute paths in errors | none |
| 1 | [S5](sessions/S5-config-ops-tests.md) | Config/env gaps, log retention, test runner, auth/generation tests, `typecheck` script | none |
| 2 | [S6](sessions/S6-read-path-perf.md) | Read path: one active-revision lookup per call, O(F²) re-sync fix, scope-checked reads | S2, S4 |
| 3 | [S7](sessions/S7-tool-api-and-untrusted.md) | Bounded `list_my_open_prs` / `sync_my_open_prs`, untrusted-content delimiters, parallel discovery | S6 |
| 4 | [S8](sessions/S8-context-service-split.md) | Split `context.service.ts`, shared error/clean helpers, dead code | S7 |
| 5 | [S9](sessions/S9-integration-verify.md) | Merge, full verification, docs and hub contract sync | all |

```
Wave 1:  S1  S2  S3  S4  S5      (parallel)
              \      /
Wave 2:         S6
                 |
Wave 3:         S7
                 |
Wave 4:         S8
                 |
Wave 5:         S9
```

## File ownership

An agent edits only the files its session owns. If a change elsewhere is needed, write it under "Handoff notes" at the end of the session file and leave the file alone.

| File | Wave 1 owner | Later owners |
|---|---|---|
| `src/core/privacy/secret.scanner.ts` | S1 | |
| `src/core/analyzer/sensitive.file.policy.ts` | S1 | |
| `src/core/bitbucket/pagination.ts` | S1 | |
| `tests/security.test.ts`, `tests/privacy.test.ts` | S1 | |
| `src/core/storage/secure-file.ts` | S2 | |
| `src/core/auth/access-gate.ts` | S2 | |
| `docs/ENCRYPTION.md` | S2 | S9 (sync only) |
| `tests/secure-file.test.ts`, new `tests/access-gate.test.ts` | S2 | |
| `src/core/bitbucket/bitbucket.client.ts`, `http.ts`, `bitbucket.collector.ts` | S3 | |
| `tests/http.test.ts` | S3 | |
| `src/core/output/revision.writer.ts`, `revision.validator.ts` | S4 | |
| `src/core/storage/atomic.writer.ts` | S4 | |
| `tests/integrity.test.ts`, `tests/atomic_write.test.ts`, `tests/unit.test.ts` | S4 | |
| `src/core/storage/data.store.ts` | S4 (the `writeRevision(...)` call site only) | S6 |
| `.env.example`, `package.json`, `bin/cli.js` | S5 | |
| `README.md` | S5 (config table only) | S7 (tool table), S9 |
| `src/config/*`, `src/utils/logger.ts`, `src/core/logging/*` | S5 | |
| `tests/run.mjs`, `tests/benchmark.test.ts`, `tests/golden.test.ts`, `tests/freshness.test.ts`, `tests/stdio.test.ts` | S5 | S6 (`freshness.test.ts` if needed) |
| new `tests/auth.test.ts`, `tests/generation.test.ts` | S5 | |
| `src/core/output/output.reader.ts` | | S6 |
| `src/mcp/context.service.ts` | | S6, then S7, then S8 |
| `tests/server.test.ts`, `tests/pipeline.test.ts` | | S6, then S7 |
| `src/mcp/tools.ts`, `src/core/output/markdown.formatter.ts` | | S7 |
| `src/core/discovery/*`, `tests/discovery.test.ts` | | S7 |
| `AGENTS.md` §4, `docs/HUB_INTEGRATION.md`, `../mcp-hub/docs/mcps/mcp-pr-companion.md` | | S7 |
| new files in `src/mcp/` | | S8 |
| `docs/ARCHITECTURE.md` | | S9 |

## Rules for every session

- **Branch:** work on `opt/S<n>-<slug>`, or in a git worktree. One conventional commit per session; the message is given in the session file.
- **Tests first:** write the listed tests before the fix and see them fail. Use `node:assert/strict` and a fake `globalThis.fetch`; never call the real Bitbucket API.
- **Done means:**
  - `npx tsc --noEmit` is clean.
  - `npm test` prints `✓ N test files passed`.
  - The docs listed in the session are updated in the same commit.
- **Frozen:** the schema v4 file names and fields (additive optional fields only), `PRC1`, and the HKDF `INFO` string.
- **No new dependency.** Follow the AGENTS.md §2 working rules: reuse what exists, use the stdlib, and mark deliberate limits with `// ponytail: <limit>, <upgrade path>`.
- **Privacy:** never put tokens, emails, repository UUIDs or absolute paths in errors, logs or test output.
- **Finishing up:** fill in "Status" and "Handoff notes" at the bottom of your session file.

## Status

| Session | Status | Commit | Notes |
|---|---|---|---|
| S1 | todo | | |
| S2 | todo | | |
| S3 | todo | | |
| S4 | todo | | |
| S5 | todo | | |
| S6 | todo | | |
| S7 | todo | | |
| S8 | todo | | |
| S9 | todo | | |
