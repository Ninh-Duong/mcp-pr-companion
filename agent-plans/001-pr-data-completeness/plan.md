# Implementation Plan: Complete PR Data for AI Agents

**Branch**: `001-pr-data-completeness` | **Date**: 2026-11-11 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification in `agent-plans/001-pr-data-completeness/spec.md`.

## Summary

Use a no-TTL PR head check before each PR-specific data read. Reuse the active schema-v4 revision when commits/state/draft still match; sync and validate only when they differ. Store independently refreshed, sanitized review comments in an encrypted sidecar and page long comment bodies through MCP. Preserve the last complete review snapshot when a fetch fails.

## Technical Context

**Language/Version**: TypeScript strict mode, ESM, Node.js >=20.12.

**Primary Dependencies**: Existing `@modelcontextprotocol/sdk`, `zod`, `p-limit`, and Node.js built-ins; no new dependency.

**Storage**: Existing encrypted schema-v4 revision tree plus a version-1 encrypted `live-review` sidecar outside `revisions/rev_*`.

**Testing**: `npm test` (isolated temp cwd), `npx tsc --noEmit`, and `node bin/cli.js check`.

**Target Platform**: Windows and other Node.js-supported platforms; MCP stdio child under mcp-hub.

**Project Type**: Read-only Bitbucket MCP server and CLI with encrypted local cache.

**Performance Goals**: One metadata check per PR-specific read; zero commit/diff fetches when the local revision matches; fetch all comment pages once per context-pack report.

**Constraints**: GET-only Bitbucket calls; sanitize before persistence/return; encrypt every file below `ai-context/`; use `AccessGate` and secure-file APIs; page growing output; preserve v4 files and behavior; keep global author-removal default true.

**Scale/Scope**: One PR per tool request; comment collection retains the existing pagination safety limit and reports incomplete results.

## Constitution Check

| Principle | Check | Design response |
|---|---|---|
| Read-only Bitbucket | Pass | Uses existing GET-only collector/client; no upstream writes. |
| Sanitization and encryption | Pass | Sanitized records only; all sidecar bytes use secure-file after access unlock. |
| Bounded and truthful output | Pass | Comment list and text detail are paged; completeness, warnings, and snapshot age are returned. |
| v4 compatibility | Pass | New separately versioned sidecar; no rename or required v4 field change. |
| Test-first | Pass | Each implementation task starts with a focused failing test and proves RED before code. |
| Simplicity | Pass | Reuses current client, sanitizers, access gate, secure-file, and pagination; no new package. |

**Post-design check**: No constitution violations. MCP annotations will mark tools that can refresh/write local state as non-read-only.

## Project Structure

### Documentation (this feature)

```text
agent-plans/001-pr-data-completeness/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/pr-comments.md
├── tasks.md
└── checklists/
    ├── requirements.md
    ├── storage-security.md
    └── mcp-contract.md
```

### Source Code

```text
src/core/output/
├── live-review-snapshot.store.ts     # validate, encrypt, publish and read review snapshots
└── schema/live-review.v1.schema.ts   # versioned index and comment record schemas
src/mcp/
├── context.service.ts                # per-read freshness, report refresh, comment pagination
└── tools.ts                          # comment detail tool and updated contracts/annotations
tests/
├── live-review-snapshot.test.ts      # encryption, atomic publication, validation
├── freshness.test.ts                 # per-read checks and unchanged-revision reuse
└── server.test.ts                    # report, comments, privacy, paging and access behavior
```

Existing readers and v4 schemas stay compatible. The sidecar lives at `ai-context/<company?>/<workspace>/<repo>/<status>/pr_<id>/live-review/`, with `current.json`, encrypted `last-attempt.json`, and `snapshots/<id>/{index.json,comments.jsonl}`. Because a PR can move between status directories, status migration must carry the latest complete encrypted `live-review/` tree along with the revision data before removing the old PR directory. `current.json` is written last; old current snapshot remains readable until the new complete snapshot validates and publishes.

## Agent and Phase Strategy

- Coordinator owns Spec Kit artifacts and shared interfaces; research agents only return findings.
- Storage agent implements the sidecar store and its tests first. Freshness/comment orchestration depends on that interface and runs afterward.
- Storage integration must preserve sidecars when `RevisionWriter` migrates a PR between status directories; select the newest valid complete snapshot and keep the source intact if migration fails.
- Once the public tool contract is fixed, separate agents may update child docs and the sibling mcp-hub contract in parallel. No two implementers edit the same source/test file at once.
- Each task uses a fresh implementer and task reviewer under `subagent-driven-development`; TDD is mandatory. Coordinator integrates and resolves review findings.

### Execution stages and skills

| Stage | Owner and parallelism | Skills applied | Completion gate |
|---|---|---|---|
| Bootstrap Spec Kit and constitution | Coordinator, sequential | `speckit-plan`, `speckit-constitution` | Codex/PowerShell Spec Kit works; generated files inspected; existing agent rules preserved. |
| Specify and clarify | Coordinator owns artifacts; independent read-only research agents | `speckit-specify`, `speckit-clarify`, `dispatching-parallel-agents` | User scenarios, requirements, and decisions are explicit in `spec.md` and `research.md`. |
| Design and task breakdown | Coordinator, sequential | `speckit-plan`, `speckit-tasks`, `speckit-checklist`, `speckit-analyze` | Data model, contracts, quickstart, dependency order, acceptance checklists, and consistency analysis are complete. |
| Implementation tasks | Fresh implementer and reviewer per task; parallel only on disjoint files | `subagent-driven-development`, `test-driven-development`; `receiving-code-review` when resolving findings | Each task has a failing-first regression test, green verification, spec-compliance review, and scoped re-review for fixes. |
| Converge and finish | Coordinator with final independent reviewer | `speckit-converge`, `speckit-implement`, `verification-before-completion`, `requesting-code-review`, `finishing-a-development-branch` | No remaining tasks, required checks pass, and whole-branch review findings are resolved or explicitly adjudicated. |

## Complexity Tracking

No constitution violations or extra dependencies.
