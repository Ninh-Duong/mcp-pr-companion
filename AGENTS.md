# AGENTS.md: operating manual for AI agents

This repository is built almost entirely by AI agents. Any agent that edits it (Claude, Codex, Gemini, Cursor, Copilot, …) must follow this file. When something here conflicts with your habits, this file wins. When it conflicts with the code, the code is a bug: fix the code or ask the user. Do not quietly change the rule.

**What this is:** a read-only MCP server (stdio) plus a terminal CLI. Both turn Bitbucket Cloud pull requests into privacy-sanitized, paged context for AI agents. Most of the time it runs as a child of [mcp-hub](docs/HUB_INTEGRATION.md), which renames its tools to `pr__<tool>`.

---

## 1. Invariants (never break these)

| # | Rule | Why | Enforced by |
|---|---|---|---|
| 1 | **stdout carries only JSON-RPC.** Never use `console.log` / `process.stdout` in `src/mcp/`, `src/core/` or `src/utils/`. Log through `Logger` (`src/utils/logger.ts`), which writes to stderr and `Logs/mcp-server.log`. `console.log` is allowed only in `src/cmd/` (the interactive CLI). | One stray line corrupts the MCP stream and the hub drops the server. | `tests/stdio.test.ts` |
| 2 | **Bitbucket is read-only.** Only `GET` requests, all through `src/core/bitbucket/bitbucket.client.ts` (or `pagination.ts`). Never add approve, merge, comment or any other write call. The token needs only `read:user`, `read:pullrequest` and `read:repository`. | The product promise and the token scopes in `.env.example`. | review |
| 3 | **Nothing unsanitized leaves the process.** Everything persisted or returned passes through `DataStore.saveRevision` (allowlist projection → `PIISanitizer` → `SecretScanner` → `PathSanitizer`). Tool errors pass through `SecretScanner`. Never return raw API responses, and never put a token, email or full path in an error message. | Users point agents at private repositories. | `tests/security.test.ts`, `tests/server.test.ts` §8 |
| 4 | **Tool output is bounded.** Any text that can grow with the PR is paged with `offset` / `max_chars` through `PRContextService.page()`. Lists take a `limit`. | A hub client has a context budget. One unbounded diff fills it. | `tests/server.test.ts` §7 |
| 5 | **The disk is the source of truth.** No in-memory caches of PR data. `current.json` is the commit point: it is written last, after `RevisionValidator` passes. | Several processes (CLI, MCP) share `ai-context/`. | `tests/atomic_write.test.ts`, `tests/integrity.test.ts` |
| 6 | **Paths are relative to the working directory, and the launcher sets it.** Every entry point runs through `bin/cli.js`, which spawns with `cwd` = project root. Keep using relative paths (`ai-context/`, `Logs/`, `.mcp-pr-companion/`) and never hardcode absolute paths. Tests rely on this: `tests/run.mjs` runs each file in a temp cwd. | Portable across machines and isolated in tests. | `tests/run.mjs` |
| 7 | **The schema v4 on-disk format is frozen.** Do not rename `current.json`, `manifest.json`, `files.index.jsonl`, `commits.jsonl`, `coverage.json`, `files/<id>/change.json`, `patch.diff`, the `file_NNNN` id format or any schema field. Additive optional fields are fine; update the zod schema in `src/core/output/schema/` in the same change. | Existing `ai-context/` folders and other tools read them. | `tests/contract.test.ts` |
| 8 | **No new dependency** without a row in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) explaining why stdlib or an installed package cannot do it. | Supply chain and startup time. Every child of the hub runs `npm ci`. | review |
| 9 | **Configuration lives only in env vars** (`.env`, loaded by `bin/cli.js` via `process.loadEnvFile`). Read env in `src/config/config.manager.ts` only. Add each new variable to `.env.example` and the README config table. Never read `.env` from code, never print values, never commit `.env`. | One place to look, and secrets stay out of git. | `.gitignore` |
| 10 | **`ALLOWED_EMAILS` is enforced on every path.** The CLI checks it at login; the MCP path checks it in `BitbucketCollector`'s constructor. Do not construct a `BitbucketClient` from env credentials anywhere else. | Lets a team lock the tool to known accounts. | `tests/server.test.ts` §11 |

## 2. Working rules

- **Ponytail first:** reuse what exists, then the stdlib, then a one-liner, and only then new code. No abstractions with one implementation, no config for values that never change, no "for later" scaffolding. When you knowingly take a shortcut with a limit, mark it `// ponytail: <limit>, <upgrade path>` (examples: `Logger`, `RevisionWriter.KEEP_REVISIONS`).
- **Fix the root cause:** before editing a shared function, grep its callers. Fix it once, where every caller passes through.
- **Tests come with every change:** a bug fix starts with a test that fails without the fix. Run `npm test`, which runs every `tests/*.test.ts` in a temp cwd (see §5).
- **Docs change with the code, in the same commit.** Use this map:

  | You changed | Also update |
  |---|---|
  | A tool's name, parameters or behaviour | `INSTRUCTIONS` in `src/mcp/tools.ts`, §4 below, the README tool table, `docs/HUB_INTEGRATION.md` §3, and `../mcp-hub/docs/mcps/mcp-pr-companion.md` (plus `../mcp-hub/scripts/smoke.py` if `check_bitbucket_connection` changes). Follow `../mcp-hub/docs/child-mcp-compatibility.md`. |
  | An env variable | `.env.example`, the README config table |
  | A dependency | `docs/DEPENDENCIES.md` |
  | The pipeline or the on-disk layout | `docs/ARCHITECTURE.md` |
  | The launch command or log path | `docs/HUB_INTEGRATION.md` and the hub contract |

- **Keep changes surgical.** Do not reformat files you did not need to touch. Do not rename modules as a side quest.
- **Language:** code, comments, logs, error messages and docs for agents are in English. `README.md` is for people and is in Vietnamese.

## 3. Code map

| Path | Responsibility |
|---|---|
| `bin/cli.js` | Launcher (stdlib only): Node version check, `npm ci`, build when `src/` changed, `.env` load and required keys, then spawns an entry with `cwd` = root. Commands: `server` (default), `cmd`, `generate-all`, `check`, `prepare`. |
| `src/mcp/server.ts` | MCP stdio entry point, kept tiny. |
| `src/mcp/tools.ts` | `createServer()`: tool registration (zod `inputSchema`, `annotations`), `run()` error wrapper, `INSTRUCTIONS`. |
| `src/mcp/context.service.ts` | `PRContextService`: freshness check and sync (`ensureFresh`, `sync` with in-flight dedup), local reads, `page()`. |
| `src/config/` | `config.manager.ts` (the only reader of env) · `config.schema.ts` (zod; turns env strings into typed values). |
| `src/core/bitbucket/` | `bitbucket.client.ts` (every HTTP call) · `pagination.ts` (follows `next`, same origin only) · `bitbucket.collector.ts` (metadata, then commits/diffstat/diff in parallel; credentials and `ALLOWED_EMAILS`) · `bitbucket.allowlist.ts` (field projection). |
| `src/core/storage/data.store.ts` | `saveRevision`: raw revision → sanitized v4 manifest, index and per-file changes. The heart of the pipeline. |
| `src/core/analyzer/` | Regex/heuristic analysis: `diff.parser` · `change.classifier` (kind) · `risk.analyzer` (tags/level) · `symbol.extractor` · `context-mode.classifier` (Read Strategy) · `sensitive.file.policy`. |
| `src/core/privacy/` | `secret.scanner` (**the** secret redactor) · `pii.sanitizer` · `path.sanitizer` · `redaction.report`. |
| `src/core/output/` | `revision.writer` (staged write, validate, swap, pack files, prune) · `revision.validator` · `output.reader` · `markdown.formatter` · `store-path.resolver` · `schema/*.v4.schema.ts`. |
| `src/core/auth/`, `discovery/`, `generation/`, `orchestration/` | CLI only: login and capability probe, finding the user's open PRs, batch generation. |
| `src/core/logging/` | CLI run logs (`Logs/<date>/*.jsonl`) · `log.redactor` (SecretScanner plus emails, UUIDs and repo identity). |
| `src/cmd/` | Interactive terminal UI (`@inquirer/prompts`). |
| `src/utils/` | `logger.ts` · `text.normalizer.ts`. |
| `tests/` | `run.mjs` (runner) · `server.test.ts` (MCP tools end to end) · `stdio.test.ts` · domain tests. |

## 4. MCP tools reference

The PR tools take `pr_url` (`https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`). Only `get_pr_context_pack` and `check_bitbucket_connection` contact Bitbucket. The file tools read the local revision and fail with `Error: PR is not synced yet…` until `get_pr_context_pack` has run.

| Tool | Parameters (defaults) | Returns | Annotations |
|---|---|---|---|
| `get_pr_context_pack` | `refresh` (false), `include_file_table` (false) | Markdown: Read Strategy (`Read next` / `Optional` / `Skip`), overview, change summary, description, commits. Starts with a `Note:` when Bitbucket could not be reached and cached data is shown. | writes local cache · open world |
| `search_pr_files` | `path`, `language`, `status`, `change_kind`, `risk_tag`, `limit` (50, max 200) | JSON `{total, files[]}`. `path` matches the **sanitized** path. | read-only · local |
| `get_pr_file_context` | `file_id`, `offset` (0), `max_chars` (16000) | Markdown for one file plus a sanitized diff page. Ends with `continue with offset N.` when there is more. | read-only · local |
| `get_pr_file_changes` | `file_id`, `include_patch` (true), `offset`, `max_chars` | JSON `{change, patch?: {text, total_chars, next_offset}}` | read-only · local |
| `get_pr_sync_status` | none | JSON `{synced, revision, updated_at, source_commit, target_commit, ai_reading_mode, stats}` | read-only · local |
| `check_bitbucket_connection` | none (no `pr_url`) | JSON `{connected: true}`, or an error naming the cause (HTTP 401 credentials, 403 missing `read:user`, unreachable, `ALLOWED_EMAILS`). The hub smoke check uses it. | read-only · open world |

**Freshness:** `get_pr_context_pack` makes one metadata request. If the PR's source or target commit differs from `current.json`, it re-syncs. `refresh=true` forces a re-sync. Concurrent syncs of one PR share a single fetch.

**Tool rule:** register with `server.registerTool(name, { title, description, inputSchema, annotations }, handler)` and wrap the body in `run(name, …)`. Set `readOnlyHint` (false only if the tool writes, even to the local cache) and `openWorldHint` (true if it calls Bitbucket). Errors are thrown as `Error` with an actionable message and become `isError` results prefixed `Error:`. The hub treats that prefix as a failure.

**Instructions rule:** `INSTRUCTIONS` in `src/mcp/tools.ts` is sent on `initialize`. It is the only guidance an agent in another repository gets. Keep it under 1,500 characters (Claude Code truncates server instructions at 4,096) and update it whenever a tool changes.

### Adding a tool (3 steps)

1. Add the logic as a static method on `PRContextService` (or reuse `OutputReader`). Page any text that can grow.
2. Register it in `createServer()` with zod fields (reuse `prUrl`, `fileId`, `offset`, `maxChars`) and annotations.
3. Add cases to `tests/server.test.ts`, update the expected tool list in `tests/stdio.test.ts`, then update the docs listed in the §2 map. The hub needs the new tool in its `hub.json` allowlist before agents can see it.

## 5. Testing

- `npm test` runs `tests/run.mjs`: each `tests/*.test.ts` runs under `tsx` in a fresh temp cwd, so tests never touch the real `ai-context/`, `Logs/` or `.mcp-pr-companion/`. Tests import `../src/*.ts` directly; no build is needed.
- Fake Bitbucket by replacing `globalThis.fetch` (see `tests/server.test.ts`, `tests/discovery.test.ts`). Never call the real API from a test.
- Test MCP tools through a real `McpServer` + `Client` over `InMemoryTransport` (`tests/server.test.ts`), so zod defaults and validation behave as in production.
- Use `node:assert/strict` in new tests. Do not add a test framework.

## 6. Definition of done

1. `npx tsc --noEmit` is clean.
2. `npm test` reports `✓ N test files passed`.
3. `node bin/cli.js check` is all ✓ (on a machine with a filled `.env`).
4. Docs are updated per the §2 map.
5. Conventional commit message (`feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`).

## 7. Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): pipeline, on-disk layout, atomicity, freshness.
- [docs/STANDARDS.md](docs/STANDARDS.md): code style, tool and privacy contracts, error handling.
- [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md): every dependency and what we deliberately avoid.
- [docs/HUB_INTEGRATION.md](docs/HUB_INTEGRATION.md): running as an mcp-hub child.
