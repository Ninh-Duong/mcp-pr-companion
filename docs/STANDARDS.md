# Coding standards and contracts

## 1. Language and runtime

- TypeScript `strict`, ESM (`"type": "module"`, `NodeNext`). Relative imports end in `.js`.
- Node ≥ 20.12 (`engines`). `process.loadEnvFile` and `AbortSignal.any` need it. CI and Docker use Node 22.
- Prefer built-ins: `fetch`, `node:fs`, `node:path`, `node:crypto`, `node:assert`. See [DEPENDENCIES.md](DEPENDENCIES.md).

## 2. Code organization

- One responsibility per file; the code map is in [AGENTS.md §3](../AGENTS.md#3-code-map). Static-method classes are the house style; follow it rather than mixing in new patterns.
- No dead code. Delete unused exports, parameters and options instead of keeping them "for later". Git remembers.
- No option that does nothing. If a parameter is accepted, it must change behaviour, and a test must show that.
- Comments explain *why*, not *what*. A deliberate limit is written as `// ponytail: <limit>, <upgrade path>`.
- New positional parameter lists stay at 5 or fewer; pass an object beyond that. `RevisionWriter.writeRevision` is a known exception.

## 3. MCP tool contract

| Aspect | Rule |
|---|---|
| Registration | `server.registerTool` in `src/mcp/tools.ts` only, with `title`, an agent-oriented `description`, a zod `inputSchema` and `annotations`. |
| Naming | Use descriptive snake_case names such as `get_pr_*`, `search_pr_*`, and `list_synced_prs`. Never add a prefix in the child: mcp-hub adds `pr__`. |
| Input | Validate with zod. Reuse `prUrl`, `fileId`, `offset` and `maxChars`. Defaults live in zod (`.default()`), not in handlers. |
| Output | One text block: compact `JSON.stringify` (no pretty-print) or Markdown. |
| Size | Anything that can grow is paged: `offset` + `max_chars` (500–100000, default 16000) through `PRContextService.page()`. Lists take a `limit` with a max. |
| Errors | Throw `Error` with an actionable message ("call X first", "use Y to list ids"). `run()` turns it into `{ isError: true, text: "Error: …" }` after `SecretScanner`. Log only the tool name and error type. |
| Annotations | `readOnlyHint: false` if the tool writes anything, the local cache included. `openWorldHint: true` if it calls Bitbucket. |
| Side effects | `get_pr_context_pack`, `sync_my_open_prs` (also run at startup by `AUTO_SYNC_ON_START`), and the CLI `sync <mode>` may sync. File tools and `list_synced_prs` are local reads after the repository access check. `check_bitbucket_connection` is the read-only upstream health check required by mcp-hub; keep its success payload `{"connected": true}` (the hub smoke check validates it). |
| Instructions | `INSTRUCTIONS` < 1,500 characters, covering workflow and paging. Update it with every tool change. |

## 4. Privacy contract

| Data | Rule | Code |
|---|---|---|
| Tokens, keys, passwords, connection strings, JWTs | Replaced by `[REDACTED:<CATEGORY>]` in every persisted text, patch, warning, tool error and log line | `SecretScanner` (single source; add patterns there) |
| Emails, account UUIDs and HTML tags in PR title, description and commits | Replaced with `[REDACTED:EMAIL]` / `[REDACTED:UUID]`; tags stripped | `PIISanitizer` |
| Author | Dropped unless `PRIVACY_REMOVE_AUTHOR=false` | `BitbucketAllowlistProjector` |
| File paths | `PRIVACY_FILE_PATH_MODE`: `sanitized` (`first/.../last/two`, the default), `basename`, `opaque` (`file_NNNN`) or `full`. Applied to the index, file Markdown and diff headers. | `PathSanitizer`, `DataStore.saveRevision` |
| Sensitive files (`.env`, keys, …) | Flagged high risk with `sensitive_configuration` | `SensitiveFilePolicy` |
| PR comments | Same as PR text (`PIISanitizer` + `SecretScanner`). Author only when `PRIVACY_REMOVE_AUTHOR=false`. Inline paths per `PRIVACY_FILE_PATH_MODE` (omitted in `opaque`). Deleted comments dropped. | `PRContextService.getComments` |
| CLI logs | Additionally strip emails, UUIDs and `workspace/repo` | `LogRedactor` |
| Credentials | Exist only in env and memory. Never written to disk, logged or echoed. | `ConfigManager`, `bin/cli.js` |
| Everything under `ai-context/` | Encrypted at rest (`PRC1`, AES-256-GCM). Readable only after `AccessGate.unlock()`. The repository UUID (key material) is never logged, returned or written. Only names stay plaintext: never put content in a file or folder name. | `secure-file.ts`, `access-gate.ts`, [ENCRYPTION.md](ENCRYPTION.md) |

When you add a new field to the output, decide which row applies **before** writing the code.

## 5. Error handling and resilience

- Every request goes through `fetchWithRetry` (`src/core/bitbucket/http.ts`). Timeouts are per attempt: 30 s for JSON requests and each page, 45 s for the raw diff.
- Pagination follows `next` only on the same origin (the auth header never goes to another host). The status sync follows all available pages and reports an incomplete result if pagination stops early.
- A failing commits, diffstat or diff request degrades `coverage` to `partial`/`failed` with a warning; a failing metadata request fails the sync.
- Retries: at most 2, only on 429/502/503/504, waiting `Retry-After` (capped at 10 s) or 1 s, then 3 s. Never on 4xx auth/permission errors. Do not add retries anywhere else.
- Logging never throws (`Logger`, `FileLogger` swallow write errors).

## 6. Testing

See [AGENTS.md §5](../AGENTS.md#5-testing). In short: `npm test` runs each file in a temp cwd, Bitbucket is faked through `globalThis.fetch`, tools are tested through a real MCP client, and every bug fix comes with a test that failed before it.
