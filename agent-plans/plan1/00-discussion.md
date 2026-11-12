# Discussion record (2026-11-12)

This records the conversation that produced Plan 1, so an agent picking up a session knows what was checked, what was found and what was decided.

## 1. Connection check: "AI agents cannot call mcp-pr-companion"

### From Claude Code (VS Code)

- **Hub:** `hub__status` showed 5/5 children connected, including `mcp-pr-companion`.
- **Real call:** `pr__list_my_open_prs` (planned through `hub__plan`) succeeded and returned 549 open PRs in `example-org/wec.be`, about 186 KB of JSON in a single response. That response is the evidence for finding INV-4a: the tool has no `limit`.
- **Readiness:** `node bin/cli.js check` was all ✓: Node 26.13.0, dependencies, build, and config (credentials, workspace and repository from local `.env`; `ALLOWED_EMAILS` unset).
- **Server log:** `Logs/mcp-server.log` showed normal starts and no errors.

### From Antigravity

- **Symptom:** the agent reported that only `rea` was available, so `mcp-hub` was not loaded in that session.
- **Config is correct:** `~/.gemini/antigravity/mcp_config.json` and `~/.gemini/config/mcp_config.json` both start the hub with `scripts/start.ps1 -Bridge -ClientName Antigravity`.
- **It worked earlier:** Antigravity's tool cache (`~/.gemini/antigravity/mcp/mcp-hub/`) held all 10 `pr__*` tools at 02:43 that day.
- **Bridge works now:** running the same bridge command by hand and sending MCP `initialize` + `tools/list` returned all 10 `pr__*` tools, with no stderr output.
- **Conclusion:** the client-side session failed to load the server (it was not ready at session start, or was disabled or timed out). This was not a repository bug.
- **Fix given to the user:** Antigravity → MCP Servers → Manage → enable `mcp-hub`, Refresh, then open a new conversation and include the PR URL.

### Side finding outside this repository

`mcp-hub/logs/children/` (the mcp-jira-sync log) records Atlassian media download URLs with the `token=` query parameter. That repository should redact them, and the existing logs should be cleaned.

## 2. Review (three parallel read-only reviews)

The reviews covered architecture and performance, security, and tests/docs/operations. The findings are in [01-findings.md](01-findings.md).

### Strengths to keep when refactoring

- **One HTTP path:** `fetchWithRetry` in `src/core/bitbucket/http.ts` is the only place that calls `fetch()`. Every Bitbucket request is a `GET`.
- **Layered privacy pipeline:**
  - Stored data goes through allowlist projection → PII → `SecretScanner` → `PathSanitizer` (`src/core/storage/data.store.ts`).
  - Tool errors are redacted in `run()` (`src/mcp/tools.ts`).
- **Encryption at rest:** AES-256-GCM, a random salt and IV for every file, and the header authenticated as AAD (`src/core/storage/secure-file.ts`).
- **No path traversal found:**
  - `pr_url` must be https on `bitbucket.org`, contain no `..`, and use slug regexes.
  - `file_id` is normalized to `file_\d{4,}`.
  - `repository` must match `^[\w.-]+/[\w.-]+$`.
- **Safe publish:** a revision is written to a staging dir, validated, then renamed; `current.json` is written last as the commit point (`src/core/output/revision.writer.ts`).
- **Low Bitbucket load:**
  - Concurrent syncs of one PR share one fetch.
  - A 120 s freshness TTL avoids repeat checks.
  - The collector fetches in parallel.
  - Pagination follows only same-origin `next` links and detects loops.
- **Strong tests:**
  - `tests/server.test.ts` drives a real `McpServer` and `Client` over `InMemoryTransport` with a fake `fetch`.
  - Every test file runs in its own temp cwd.
  - CI runs on Ubuntu, Windows and macOS.
- **Lean dependencies:** 4 runtime and 3 dev dependencies.
- **Tool docs agree:** AGENTS.md §4, README, HUB_INTEGRATION and `INSTRUCTIONS` (1,077 characters) all list the same 10 tools.

### Security review

- **High:** none.
- **Medium:**
  - SEC-1: secret patterns such as `DB_PASSWORD=` / `POSTGRES_PASSWORD:` are not redacted. Verified: `\b` before `password` fails after `_`.
  - SEC-2: PR text written by users reaches agents with no untrusted marking, which is a prompt-injection risk under a hub that also exposes SQL and Jira tools.
- **Low:**
  - SEC-3: the decrypted header is not checked against the file's location.
  - SEC-4: the key comes from the repository UUID, so encryption only stops casual reading.
  - SEC-5: `npm ci` runs install scripts.
  - SEC-6: pagination warnings carry raw error bodies.
- **Confirmed safe:**
  - No write HTTP method anywhere.
  - `ALLOWED_EMAILS` is enforced on the MCP path.
  - `.gitignore` covers `.env*`, `ai-context/`, `Logs/` and `.mcp-pr-companion/`.
  - The logger writes metadata only.
  - No command injection in the launcher's `spawn` calls.

## 3. Decisions

1. **Language:** documents in `agent-plans/` are in English, per AGENTS.md §2.
2. **Execution:** work is split into sessions with exclusive file ownership and run in waves (see [README.md](README.md)), so several agents can work in parallel without conflicts.
3. **Frozen formats:**
   - No change to the schema v4 file names and fields, beyond optional additions.
   - No change to `PRC1` or the HKDF `INFO` string.
   - Path-bound AAD (a header `v:2`) is deferred and documented as an upgrade path.
4. **No new dependencies.**
5. **OPS-2 deferred:** deleting merged or declined PRs from `ai-context/` deletes user data and needs an owner decision. It is recorded, not implemented.
6. **Untrusted content:**
   - Use explicit delimiters (`<untrusted_pr_content source="…">`) plus one sentence in `INSTRUCTIONS`.
   - Only newly written `context.md` files get the delimiters; older ones get them on the next re-sync.
7. **Bounded output:** `list_my_open_prs` gains `offset`/`limit`, using the same shape as `list_synced_prs`. `sync_my_open_prs` keeps syncing everything but caps its `prs` list.
8. **Scope of this request:** this plan only creates the documents. Code changes are done later by the session agents.
