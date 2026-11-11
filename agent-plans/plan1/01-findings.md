# Findings

Line numbers refer to commit `9ef1cbc`. Severity: H = high, M = medium, L = low.

## Security

| ID | Sev | Evidence | Finding | Session |
|---|---|---|---|---|
| SEC-1 | M | `src/core/privacy/secret.scanner.ts:81,86` | `password_assignment` starts with `\b`, which does not match after `_`, so `DB_PASSWORD=x`, `POSTGRES_PASSWORD: x` and `JWT_SECRET=x` pass unredacted. `api_token` knows only fixed prefixes, so a bare `token: x` / `SECRET=x` is missed. There is no Slack webhook rule. These secrets get stored and returned to agents and LLM providers, which breaks invariant 3. | S1 |
| SEC-2 | M | `src/core/output/markdown.formatter.ts:76-91`, `src/mcp/context.service.ts:289-347` | The PR description, commit subjects, diffs and comments reach agents as plain text, with no untrusted marking. Under mcp-hub the same agent has SQL, logs and Jira tools, so a PR comment can carry a prompt injection. | S7 |
| SEC-3 | L | `src/core/storage/secure-file.ts:85-105`, `src/core/output/output.reader.ts:25` | `decryptBuffer` takes the key from the header's repository, and nobody compares the header with the path being read. Ciphertext can be swapped between PRs, revisions or files, and repo A's data can be read under repo B's path while A is unlocked. Exploiting it needs local write access. | S2 (API), S6 (callers) |
| SEC-4 | L | `docs/ENCRYPTION.md` | The key material is the repository UUID, which anyone holding the `.env` token can fetch, and anonymous users can fetch for public repos. The docs do not state that this is protection against casual reading, not confidentiality. | S2 |
| SEC-5 | L | `bin/cli.js:168` | `npm ci` runs dependency install scripts whenever the lockfile changes, so a compromised dependency gets code execution. | S5 |
| SEC-6 | L | `src/core/bitbucket/pagination.ts:39,55` | Warnings include up to 100 characters of the raw error body, and the error message, without `SecretScanner`. | S1 |

## Invariant violations

| ID | Inv | Evidence | Finding | Session |
|---|---|---|---|---|
| INV-3a | 3 | `src/core/output/revision.validator.ts:28-31` | Validation errors contain absolute staging paths. They reach tool output through `validateOrThrow` → `sync` → `run()`, and `SecretScanner` has no path rule. | S4 |
| INV-4a | 4 | `src/mcp/tools.ts:149-161`, `context.service.ts:350-364` | `list_my_open_prs` has no `limit`/`offset`. A real call returned 549 PRs (about 186 KB). | S7 |
| INV-4b | 4 | `context.service.ts:425-455` | The `prs` array of `sync_my_open_prs` is unbounded. | S7 |
| INV-5 | 5 | `src/core/discovery/pr-discovery.service.ts:95` | The MCP path stores discovered PRs (titles included) in the process-wide `DiscoveryCache`. Only the CLI reads it. | S7 |
| INV-9a | 9 | `.env.example`, `src/config/config.manager.ts:34` | `FRESHNESS_TTL_SECONDS` is missing from `.env.example`. | S5 |
| INV-9b | 9 | `src/utils/logger.ts:51` | Reads `process.env.DEBUG` directly instead of through `ConfigManager`. | S5 |
| INV-9c | 9 | `README.md` config table | The `PRIVACY_*` variables share one row. `PRIVACY_MODE` only labels the redaction report, but the docs present it as a behaviour switch. | S5 |

## Performance

| ID | Evidence | Finding | Session |
|---|---|---|---|
| PERF-1 | `output.reader.ts:125-139,170-196`, `context.service.ts:108,160,167,172-176,325` | `getActiveRevision` probes up to 15 directories and decrypts `current.json` and `manifest.json` in each one that exists. Each tool call runs it 2–4 times. | S6 |
| PERF-2 | `data.store.ts:299-318`, `output.reader.ts:141-161` | `diffAgainstActive` calls `getFileChange` once per previous file, and each call re-runs `getActiveRevision` even when a `revisionId` is given. That is O(F²) decrypts per re-sync. | S6 |
| PERF-3 | `revision.writer.ts:109`, `revision.validator.ts:40-80` | After writing a revision, the validator decrypts every file it just wrote. | S4 |
| PERF-4 | `revision.writer.ts:87-133`, `atomic.writer.ts` | About 3F+8 synchronous writes, each with an `fsync`. They block the MCP stdio loop. | S4 |
| PERF-5 | `bitbucket.client.ts:23-31` | Commits and diffstat use Bitbucket's small default `pagelen`, which means many round trips. | S3 |
| PERF-6 | `bitbucket.client.ts:64-73`, `diff.parser.ts` | The whole diff is loaded with `res.text()` and no size cap. Peak memory is about 4–6× the diff size. | S3 |
| PERF-7 | `access-gate.ts:17-29` | No in-flight dedup: with `pLimit(3)` and a cold cache, the same repository is checked up to 3 times at once. | S2 |
| PERF-8 | `http.ts:23-31` | Network errors (`ECONNRESET`, …) are not retried; only HTTP 429/5xx are. | S3 |
| PERF-9 | `data.store.ts:162-169` | The patch is built by `+=` concatenation line by line. | S6 |
| PERF-10 | `context.service.ts:377-384` | Discovery visits repositories one after another. | S7 |

## Architecture and code quality

| ID | Evidence | Finding | Session |
|---|---|---|---|
| ARCH-1 | `src/mcp/context.service.ts` (501 lines) | One class mixes freshness, sync, live review formatting, discovery and listing. | S8 |
| ARCH-2 | `revision.writer.ts:29-44` | `writeRevision` takes 14 positional parameters. | S4 |
| ARCH-3 | `bitbucket.client.ts:19-65` | The base URL plus `encodeURIComponent` is repeated 8 times. | S3 |
| ARCH-dup | `context.service.ts:370-372,390-392` | The repository-target validation is copied. | S7 |
| ARCH-dup2 | `context.service.ts:122,232,249,315,327,450`; `data.store.ts:55` | The `scanAndRedact(err instanceof Error ? …)` and `scanAndRedact(sanitizeText(…))` lambdas are repeated. | S8 |
| ARCH-dead | `context.service.ts:37`, `discovery-cache.ts` `clear()` | `type Head = PRHead` is a pointless alias, and `clear()` only calls `clearAll()`. | S8 |

## Tests and tooling

| ID | Evidence | Finding | Session |
|---|---|---|---|
| TEST-1 | `tests/run.mjs:12-21` | The runner stops at the first failing file. | S5 |
| TEST-2 | `tests/benchmark.test.ts`, `tests/golden.test.ts` | They count passes and failures by hand instead of using `node:assert/strict` (AGENTS §5). | S5 |
| TEST-3 | `tests/stdio.test.ts:2` | The comment says "9 tools"; there are 10. | S5 |
| TEST-4 | `tests/freshness.test.ts:71-111`, `tests/privacy.test.ts:52-55` | Both replace `Date.now` globally without a `try/finally` restore. | S5 (freshness), S1 (privacy) |
| TEST-5 | `tests/http.test.ts:29-31` | Waits about 1 s of real time. | S3 |
| TEST-6 | `src/core/auth/*`, `src/core/generation/*` | No direct tests for `capability.probe` (226 lines), `auth.service` or `generation.manager`. | S5 |
| TOOL-1 | `package.json` | No `typecheck` script. | S5 |

## Operations

| ID | Evidence | Finding | Session |
|---|---|---|---|
| OPS-1 | `src/core/logging/file.logger.ts:30`, `run-summary.ts:29` | `Logs/<date>/` folders are never deleted. | S5 |
| OPS-2 | `ai-context/` | Merged and declined PR folders are kept forever. | **Deferred.** Deleting user data needs an owner decision. |
| OPS-3 | outside this repo: `mcp-hub/logs/children/` | The mcp-jira-sync log records Atlassian `token=` URLs. | Out of scope. Report to the mcp-jira-sync owner. |
