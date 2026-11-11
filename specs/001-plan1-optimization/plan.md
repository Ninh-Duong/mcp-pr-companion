# Implementation Plan: Plan 1 Review Remediation & Performance Optimization

**Branch**: `001-plan1-optimization` | **Date**: 2026-11-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/001-plan1-optimization/spec.md`

## Summary

Remediate all review findings (`SEC-1..6`, `INV-3a..9c`, `PERF-1..10`, `ARCH-1..dead`, `TEST-1..6`, `TOOL-1`, `OPS-1`) and apply four additional verified performance improvements across `mcp-pr-companion` using a 5-wave multi-agent `swarm` architecture (`workspace: "share"` for disjoint parallel authors + dedicated read-only verifiers per wave).

## Technical Context

**Language/Version**: TypeScript `5.7.2` (`strict`, ESM `NodeNext`), Node.js `>=20.12`

**Primary Dependencies**: `@modelcontextprotocol/sdk`, `@inquirer/prompts`, `p-limit`, `zod` (zero new dependencies)

**Storage**: AES-256-GCM encrypted `ai-context/` (`PRC1` v1 + HKDF-SHA256 from repo UUID) via `secure-file.ts` & `AtomicWriter`; JSONL logs in `Logs/`

**Testing**: Native `tsx` + `node:assert/strict` under isolated temp `cwd`s via `tests/run.mjs`; MCP tools verified over `InMemoryTransport`

**Target Platform**: Cross-platform Windows, macOS, Linux (local stdio server + CLI + optional Docker)

**Project Type**: Local stdio MCP server + interactive/batch CLI

**Performance Goals**:
- Single `getActiveRevision` resolution per MCP call; pre-filter missing `current.json` directories prior to decryption
- O(F) patch diffing on re-sync (`diffAgainstActive`); array-join patch assembly (`PERF-9`) + in-place `.push()` tag/thread grouping
- `<= 12` `fsyncSync` calls on a 10-file revision (`writeStaged` + per-directory flush including `files/<id>.md`)
- `20 MB` streaming diff cap + `pagelen=100` for commits/diffstat + in-flight `AccessGate.unlock` dedup + parallel multi-repo discovery
- Bounded parallel test execution (`tests/run.mjs`) cutting full suite runtime

**Constraints**:
- Strictly read-only `GET` requests via `fetchWithRetry` (`src/core/bitbucket/http.ts`)
- Frozen Schema v4 filenames/fields, `PRC1`, and HKDF `INFO` string
- Pure JSON-RPC on `stdout`; `INSTRUCTIONS` `< 1,500` chars; zero new npm dependencies

**Scale/Scope**: 9 sessions across 5 waves (~30 modified/new source, test, and documentation files)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Gate Verification | Status |
|---|---|---|
| I. Pure JSON-RPC Stdio | All server/core logs stay on `Logger` (`stderr` + `Logs/mcp-server.log`); `stdio.test.ts` verifies JSON-RPC frames | PASS |
| II. Read-Only Bitbucket | Only `GET` via `fetchWithRetry` in `src/core/bitbucket/http.ts`; S3 adds network retry & diff cap only there | PASS |
| III. Mandatory Sanitization | S1 closes `DB_PASSWORD`/`SECRET`/`token:`/Slack/pagination gaps; S4 strips abs paths; S7 adds `<untrusted_pr_content>` | PASS |
| IV. Bounded Outputs | S7 adds `offset`/`limit` (default 50, max 200) to `list_my_open_prs` & 50-row unchanged cap to `sync_my_open_prs` | PASS |
| V. Disk Source of Truth | S7 removes MCP `DiscoveryCache.setPRs` writes; S4 preserves staging -> validate -> rename -> `current.json` last | PASS |
| VI. Frozen Formats & Zero Deps | Zero new dependencies; `PRC1`/`INFO`/Schema v4 stay frozen (`omitted_unchanged`, `content_trust` are additive) | PASS |
| VII. Config & Crypto Gate | S5 moves `DEBUG` & `LOG_RETENTION_DAYS` into `ConfigManager`; S2/S6 add `SecureScope` verification on decrypt | PASS |
| VIII. Test-First & Ponytail | Every session starts with failing `node:assert/strict` tests using fake `fetch`; S8 keeps `tests/` untouched | PASS |

## Project Structure

### Documentation (this feature)

```text
specs/001-plan1-optimization/
├── spec.md                       # Requirements & user stories (US1–US5)
├── checklists/
│   ├── requirements.md           # Spec quality checklist
│   └── quality.md                # Implementation readiness checklist
├── plan.md                       # This file
├── research.md                   # Verified findings & bug catches on 9ef1cbc
├── data-model.md                 # Types & untrusted content entities
├── contracts/
│   └── mcp-tools.md              # Additive MCP tool & instruction deltas
├── quickstart.md                 # Verification & invariant check runbook
└── tasks.md                      # Wave-ordered SpecKit tasks
```

### Source Code & Wave Ownership

```text
src/
├── config/                       # S5: config.manager.ts, config.schema.ts
├── core/
│   ├── auth/                     # S2: access-gate.ts
│   ├── bitbucket/                # S1: pagination.ts | S3: http.ts, bitbucket.client.ts, bitbucket.collector.ts
│   ├── discovery/                # S7: pr-discovery.service.ts | S8: discovery-cache.ts
│   ├── generation/               # S5: generation.job.ts (error redaction)
│   ├── logging/                  # S5: file.logger.ts, run-summary.ts
│   ├── output/                   # S4: revision.writer.ts, revision.validator.ts | S6: output.reader.ts | S7: markdown.formatter.ts
│   ├── privacy/                  # S1: secret.scanner.ts
│   └── storage/                  # S2: secure-file.ts | S4: atomic.writer.ts, data.store.ts (L272) | S6: data.store.ts
├── mcp/                          # S6/S7: tools.ts, context.service.ts | S8: text.ts, freshness.ts, review-live.ts, my-prs.ts
└── utils/                        # S5: logger.ts
tests/                            # S1..S7 isolated temp-cwd tests + S5 parallel tests/run.mjs
docs/ & README.md & AGENTS.md     # S2 (ENCRYPTION), S5 (README/.env.example), S7 (tool docs), S8 (code map), S9 (ARCHITECTURE/STANDARDS)
```

**Structure Decision**: Keep the single-project TypeScript ESM layout (`src/`, `tests/`, `bin/`, `docs/`). Split `PRContextService` in Wave 4 (`S8`) into plain exported functions inside `src/mcp/{text,freshness,review-live,my-prs}.ts` with `context.service.ts` acting as a backward-compatible static facade and DAG root (zero circular imports).

## Multi-Agent Execution Waves

- **Wave 1 (Parallel `swarm`, `workspace: "share"`):** `s1-privacy`, `s2-crypto`, `s3-http`, `s4-write`, `s5-ops-tests` + 2 verifiers (`verifier-w1a`, `verifier-w1b`). Merge all 5 disjoint branches + run full `typecheck` & `npm test`.
- **Wave 2 (`workspace: "share"`):** `s6-read-perf` + `verifier-w2` (depends on Wave 1 `S2`, `S4`, `S5`).
- **Wave 3 (`workspace: "share"`):** `s7-tool-api` + `verifier-w3` (depends on Wave 2 `S6`).
- **Wave 4 (`workspace: "share"`):** `s8-split` + `verifier-w4` (depends on Wave 3 `S7`; `git diff --stat tests/` must stay empty).
- **Wave 5:** `s9-integration` + `/speckit-converge` + full verification & invariant spot checks.

## Complexity Tracking

No constitution violations; zero new dependencies added.
