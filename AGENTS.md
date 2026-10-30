# AGENTS.md: operating manual for AI agents

This repository is built almost entirely by AI agents. Any agent that edits it (Claude, Codex, Gemini, Cursor, Copilot, …) must follow this file. When something here conflicts with your habits, this file wins. When it conflicts with the code, the code is a bug: fix the code or ask the user. Do not quietly change the rule.

**What this is:** a read-only MCP server (stdio) plus a terminal CLI. Both turn Bitbucket Cloud pull requests into privacy-sanitized, paged context for AI agents. Most of the time it runs as a child of [mcp-hub](docs/HUB_INTEGRATION.md), which renames its tools to `pr__<tool>`.

---

## 1. Invariants (never break these)

| # | Rule | Why | Enforced by |
|---|---|---|---|
| 1 | **stdout carries only JSON-RPC.** Never use `console.log` / `process.stdout` in `src/mcp/`, `src/core/` or `src/utils/`. Log through `Logger` (`src/utils/logger.ts`), which writes to stderr and `Logs/mcp-server.log`. `console.log` is allowed only in `src/cmd/` (the interactive CLI). | One stray line corrupts the MCP stream and the hub drops the server. | `tests/stdio.test.ts` |
| 2 | **Bitbucket is read-only.** Only `GET` requests, all through `src/core/bitbucket/bitbucket.client.ts` (or `pagination.ts`), which call `fetchWithRetry` in `http.ts`, the only `fetch()` call site. Never add approve, merge, comment or any other write call. The token needs only `read:user`, `read:pullrequest` and `read:repository`. | The product promise and the token scopes in `.env.example`. | review |
| 3 | **Nothing unsanitized leaves the process.** Stored PR data passes through `DataStore.saveRevision` (allowlist projection → `PIISanitizer` → `SecretScanner` → `PathSanitizer`). Live PR text uses the same sanitizers before return. Tool errors pass through `SecretScanner`. Never return raw API responses, and never put a token, email or full path in an error message. | Users point agents at private repositories. | `tests/security.test.ts`, `tests/server.test.ts` §8 |
| 4 | **Tool output is bounded.** Any growing text is paged with `offset` / `max_chars` through `PRContextService.page()` or explicitly capped. Lists take a `limit`. | A hub client has a context budget. One unbounded diff fills it. | `tests/server.test.ts` §7 |
| 5 | **The disk is the source of truth.** No in-memory caches of PR data. `current.json` is the commit point: it is written last, after `RevisionValidator` passes. PRs live under a status directory; after a valid new revision is published, retained revisions in old directories are migrated. | Several processes (CLI, MCP) share `ai-context/`. | `tests/atomic_write.test.ts`, `tests/integrity.test.ts` |
| 6 | **Paths are relative to the working directory, and the launcher sets it.** Every entry point runs through `bin/cli.js`, which spawns with `cwd` = project root. Keep using relative paths (`ai-context/`, `Logs/`, `.mcp-pr-companion/`) and never hardcode absolute paths. Tests rely on this: `tests/run.mjs` runs each file in a temp cwd. | Portable across machines and isolated in tests. | `tests/run.mjs` |
| 7 | **The schema v4 on-disk format is frozen.** Do not rename `current.json`, `manifest.json`, `files.index.jsonl`, `commits.jsonl`, `coverage.json`, `files/<id>/change.json`, `patch.diff`, the `file_NNNN` id format or any schema field. Additive optional fields are fine; update the zod schema in `src/core/output/schema/` in the same change. | Existing `ai-context/` folders and other tools read them. | `tests/contract.test.ts` |
| 8 | **No new dependency** without a row in [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) explaining why stdlib or an installed package cannot do it. | Supply chain and startup time. Every child of the hub runs `npm ci`. | review |
| 9 | **Configuration lives only in env vars** (`.env`, loaded by `bin/cli.js` via `process.loadEnvFile`; under mcp-hub, `bin/cli.js` first fills unset Bitbucket values from the hub's `bitbucket` block in `CENTRAL_CONFIG_PATH`: process env > hub > `.env`, empty = unset, see [docs/HUB_INTEGRATION.md](docs/HUB_INTEGRATION.md) §2). Read env in `src/config/config.manager.ts` only. Add each new variable to `.env.example` and the README config table. Never read `.env` from code, never print values, never commit `.env`. | One place to look, and secrets stay out of git. | `.gitignore` |
| 10 | **`ALLOWED_EMAILS` is enforced on every path.** The CLI checks it at login; the MCP path checks it in `BitbucketCollector`'s constructor. Do not construct a `BitbucketClient` from env credentials anywhere else. | Lets a team lock the tool to known accounts. | `tests/server.test.ts` §12 |
| 11 | **ai-context is encrypted at rest; only `secure-file.ts` touches its bytes.** Read and write every file under `ai-context/` through `readSecure` / `writeSecure` (`src/core/storage/secure-file.ts`), usually via `OutputReader` / `RevisionWriter`. Never `fs.readFileSync` / `writeFileSync` a file there, never decrypt elsewhere, and never put content in a file or folder name. An entry point must `await AccessGate.unlock(workspace, repo)` before reading or writing. The key material (repository UUID) stays in memory: never log it, return it or write it to disk. `PRC1` and the HKDF info string are frozen. See [docs/ENCRYPTION.md](docs/ENCRYPTION.md). | Users must not be able to read synced PR data without a successful Bitbucket check. | `tests/secure-file.test.ts`, `tests/server.test.ts` §9a |

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
  | Encryption, the access gate or what stays plaintext | `docs/ENCRYPTION.md` (and invariant 11) |
  | The launch command or log path | `docs/HUB_INTEGRATION.md` and the hub contract |

- **Keep changes surgical.** Do not reformat files you did not need to touch. Do not rename modules as a side quest.
- **Language:** source code, comments, logs, error messages and all Markdown documentation, including `README.md` and test fixtures, are in English. Keep Unicode coverage with English text where needed.

## 3. Code map

| Path | Responsibility |
|---|---|
| `bin/cli.js` | Launcher (stdlib only): Node version check, `npm ci`, build when `src/`, `tsconfig.json`, `package-lock.json` or `package.json` changed, hub `bitbucket` block (`CENTRAL_CONFIG_PATH`) and `.env` load, required keys, value sources (`PR_COMPANION_CONFIG_SOURCES`), then spawns an entry with `cwd` = root. Commands: `server` (default), `cmd`, `generate-all`, `sync <mode>`, `purge-plaintext`, `check`, `prepare`. |
| `src/mcp/server.ts` | MCP stdio entry point, kept tiny. |
| `src/mcp/tools.ts` | `createServer()`: tool registration (zod `inputSchema`, `annotations`), `run()` error wrapper, `INSTRUCTIONS`. |
| `src/mcp/context.service.ts` | `PRContextService`: freshness checks and sync (`ensureFresh`, `sync` with in-flight dedup), local reads, `listSyncedPRs`, and `page()`. |
| `src/config/` | `config.manager.ts` (the only reader of env) · `config.schema.ts` (zod; turns env strings into typed values). |
| `src/core/bitbucket/` | `bitbucket.client.ts` (every endpoint) · `http.ts` (`fetchWithRetry`: timeout, 2 retries on 429/5xx) · `pagination.ts` (follows `next`, same origin only) · `bitbucket.collector.ts` (metadata, then commits/diffstat/diff in parallel; credentials and `ALLOWED_EMAILS`) · `bitbucket.allowlist.ts` (field projection). |
| `src/core/storage/secure-file.ts` | The encrypted file format (`PRC1`, AES-256-GCM, HKDF from the repository UUID): `writeSecure`, `readSecure`, `readHeader`, `PlaintextFileError`. `purge.ts`: delete pre-encryption files. |
| `src/core/auth/access-gate.ts` | `AccessGate.unlock()`: live check (credentials, `ALLOWED_EMAILS`, repository read access), then key material in memory for 60 s. |
| `src/core/storage/data.store.ts` | `saveRevision`: raw revision → sanitized v4 manifest, index and per-file changes. The heart of the pipeline. |
| `src/core/analyzer/` | Regex/heuristic analysis: `diff.parser` · `change.classifier` (kind) · `risk.analyzer` (tags/level) · `symbol.extractor` · `context-mode.classifier` (Read Strategy) · `sensitive.file.policy`. |
| `src/core/privacy/` | `secret.scanner` (**the** secret redactor) · `pii.sanitizer` · `path.sanitizer` · `redaction.report`. |
| `src/core/output/` | `revision.writer` (staged write, validate, swap, status migration, prune) · `revision.validator` · `output.reader` · `markdown.formatter` · `store-path.resolver` · `schema/*.v4.schema.ts`. |
| `src/core/auth/`, `discovery/`, `generation/`, `orchestration/` | CLI only: login and capability probe, discovering owned PRs by state, batch generation and status sync. |
| `src/core/logging/` | CLI run logs (`Logs/<date>/*.jsonl`) · `log.redactor` (SecretScanner plus emails, UUIDs and repo identity). |
| `src/cmd/` | Interactive terminal UI (`@inquirer/prompts`); `context-viewer.screen.ts` shows decrypted synced PRs after login; `sync.runner.ts` backs `node bin/cli.js sync <mode>`; `purge-plaintext.runner.ts` backs `node bin/cli.js purge-plaintext`. |
| `src/utils/` | `logger.ts` · `text.normalizer.ts`. |
| `tests/` | `run.mjs` (runner) · `server.test.ts` (MCP tools end to end) · `stdio.test.ts` · domain tests. |

## 4. MCP tools reference

PR tools that access a PR take `pr_url` (`https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`; `/overview`, `/diff`, `/commits`, and `/activity` suffixes and case differences are accepted). Every tool that reads or writes local encrypted data first unlocks the repository with a live Bitbucket access check, cached for 60 s per repository. Local cache tools are open-world even when they do not fetch PR details. File tools fail with `Error: PR is not synced yet…` until `get_pr_context_pack`, `sync_my_open_prs`, or CLI `sync <mode>` has synced the PR.

| Tool | Parameters (defaults) | Returns | Annotations |
|---|---|---|---|
| `get_pr_context_pack` | `pr_url`, `refresh` (false), `include_file_table` (false) | Markdown: Read Strategy (`Read next` / `Optional` / `Skip`), overview, change summary, description, up to 10 non-merge commits, live approval/build counts and up to 10 live review thread summaries (no `get_pr_comments` pointer for threads it summarizes). Syncs when missing, stale, or migration is pending; within `FRESHNESS_TTL_SECONDS` (120) of the last successful check it skips the metadata request and approvals read `not rechecked`. Starts with a `Note:` when freshness could not be checked and cached data is shown; skips live sections if the metadata check is offline. | writes local cache · open world |
| `search_pr_files` | `pr_url`, `path`, `language`, `status` (`added`, `modified`, `deleted`, `renamed`), `change_kind`, `risk_tag`, `limit` (50, max 200) | JSON `{total, files[]}`. `path` matches the **sanitized** path. | read-only · open world (unlock) |
| `get_pr_file_context` | `pr_url`, `file_id` (string or nonnegative integer), `offset` (0), `max_chars` (16000; 500–100000) | Markdown for one file plus a sanitized diff page. Ends with `continue with offset N.` when there is more. | read-only · open world (unlock) |
| `get_pr_file_changes` | `pr_url`, `file_id` (string or nonnegative integer), `include_patch` (true), `offset` (0), `max_chars` (16000; 500–100000) | JSON `{change, patch?: {text, total_chars, next_offset}}`; `change.symbols` is capped at 50, with `symbols_total` when truncated. | read-only · open world (unlock) |
| `get_pr_comments` | `pr_url`, `include_resolved` (true), `offset` (0), `limit` (50, max 200) | JSON `{total, complete, comments:[{id, parent_id, file_id?, path?, line?, resolved, created_on, author?, author_kind, text}], next_offset}`. Fetched live; text is sanitized and capped at 4,000 characters; `author` only when `PRIVACY_REMOVE_AUTHOR=false`; `author_kind` is `app` or `person`; inline comments get `file_id` when the PR is synced. | read-only · open world |
| `list_synced_prs` | `repository` (`workspace/repo`; default: every `BITBUCKET_REPOSITORY` entry), `status` (optional: `open`, `draft`, `merged`, `declined`), `offset` (0), `limit` (50, max 200) | JSON `{total, prs:[{pr_url, repository, id, title, pr_status, updated_at}], next_offset}`. Reads the local cache after unlocking each repository. | read-only · open world (unlock) |
| `list_my_open_prs` | `repository` (`workspace/repo`; default: every `BITBUCKET_REPOSITORY` entry) | JSON `{total, prs:[{pr_url, repository, id, title, is_draft, source_branch, target_branch, updated_on, local}], warnings?}`. Discovers PRs live; does not write local cache. `warnings` labels a cut-off fallback listing. | read-only · open world |
| `sync_my_open_prs` | `repository` (`workspace/repo`; default: every `BITBUCKET_REPOSITORY` entry), `force` (false) | JSON `{total, synced, unchanged, failed, prs:[{pr_url, id, title, status, ticket, overall_risk, files_changed, updated_on, error?}], warnings?}`. 3 PRs at a time; a PR whose active revision matches the listing's commits, state and draft flag (and needs no migration) costs no per-PR request; a PR that differs is synced directly. `AUTO_SYNC_ON_START=true` runs the same in the background at startup. | writes local cache · open world |
| `check_bitbucket_connection` | none | JSON `{connected: true, config_source: {credentials, workspace, repository, allowed_emails}}` (each `env`, `hub`, `local` or `unset`; names only), or an error naming the cause (HTTP 401 credentials, 403 missing `read:user`, unreachable, `ALLOWED_EMAILS`). The hub smoke check uses it. | read-only · open world |
| `get_pr_sync_status` | `pr_url` | JSON `{synced, revision, updated_at, source_commit, target_commit, ai_reading_mode, pr_status, stats}` | read-only · open world (unlock) |

**Freshness:** `get_pr_context_pack` checks source and target commits in `current.json` and state and draft flag in the active manifest. A mismatch, missing revision, or pending move from a legacy/status directory triggers a full sync, which reuses the metadata response of the check. The check is skipped within `FRESHNESS_TTL_SECONDS` (default 120, 0 = always check) of the last successful one: the time of the last sync (`current.json` `updated_at`) or of the last unchanged check (`current.json` `freshness_checked_at`, an additive field rewritten in place through `writeSecure`; `sync_my_open_prs` also stamps it for unchanged PRs). Within that window the pack's approvals line reads `not rechecked`, a pending migration still triggers a sync, and a newly pushed commit is picked up when the window ends. A migration retry follows the normal repository access check. If the new encrypted revision is valid but moving old data fails, the old directory remains readable and the next sync retries it. `refresh=true` forces a re-sync. Concurrent syncs of one PR share a single fetch. When a sync replaces a different revision, the manifest gets `changes_since_previous` and `context.md` a "Changed since last sync" section (files matched by sanitized path). Approvals and build status are read live and never stored; statuses are limited to two pages, latest is selected per pipeline key, and partial pagination is labeled. Review thread summaries are live, omit author names, and show up to 10 file groups; only groups left out point to `get_pr_comments`. If Bitbucket is offline during freshness check, the cached pack is returned with a note and live sections are skipped.

**CLI status sync:** `node bin/cli.js sync <open|draft|merged|declined|all>` syncs PRs authored by the configured account across `BITBUCKET_REPOSITORY`. `open` excludes drafts; `all` combines the four disjoint groups. Historical states are requested explicitly and every page is followed. Incomplete pagination is reported and exits unsuccessfully; an individual PR failure does not stop the remaining PRs.

`node bin/cli.js check` checks Node.js, installed dependencies, build output, and required configuration, including `BITBUCKET_REPOSITORY`. `check_bitbucket_connection` is the live MCP health check for credentials and the account allowlist. A successful tool read unlocks only the requested repository, with access cached for 60 seconds; it does not imply access to other repositories.

**Tool rule:** register with `server.registerTool(name, { title, description, inputSchema, annotations }, handler)` and wrap the body in `run(name, …)`. Set `readOnlyHint` (false only if the tool writes, even to the local cache) and `openWorldHint` (true if it calls Bitbucket). Errors are thrown as `Error` with an actionable message and become `isError` results prefixed `Error:`. The hub treats that prefix as a failure.

**Instructions rule:** `INSTRUCTIONS` in `src/mcp/tools.ts` is sent on `initialize`. It is the only guidance an agent gets on a **direct** connection. mcp-hub does not forward it: under the hub, agents read the contract `../mcp-hub/docs/mcps/mcp-pr-companion.md` and tool descriptions prefixed `[pr via mcp-pr-companion]` (see [docs/HUB_INTEGRATION.md](docs/HUB_INTEGRATION.md) §4). Keep it under 1,500 characters (Claude Code truncates server instructions at 4,096) and update it whenever a tool changes.

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
- [docs/ENCRYPTION.md](docs/ENCRYPTION.md): encrypted ai-context format, key source, access gate, limits, migration.
