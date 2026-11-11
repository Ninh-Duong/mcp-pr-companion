# mcp-pr-companion Constitution

## Core Principles

### I. Pure JSON-RPC Stdio Stream (NON-NEGOTIABLE)
`stdout` MUST carry only valid MCP JSON-RPC frames. No module under `src/mcp/`, `src/core/`, or `src/utils/` may call `console.log` or write to `process.stdout`. All server and launcher diagnostics MUST go through `Logger` (`stderr` and `Logs/mcp-server.log`), while interactive terminal output (`console.log`) is permitted solely inside `src/cmd/`.

### II. Strictly Read-Only Upstream Access (NON-NEGOTIABLE)
Bitbucket Cloud integration MUST be strictly read-only (`GET` requests only). Every HTTP request MUST route through `fetchWithRetry` in `src/core/bitbucket/http.ts`, which MUST remain the sole `fetch()` call site in the codebase. No approval, merge, comment, or mutation endpoint may ever be added, and token scopes stay minimal (`read:user`, `read:pullrequest`, `read:repository`).

### III. Mandatory Privacy Sanitization & Redaction (NON-NEGOTIABLE)
No unsanitized upstream text, secret, token, credential, email, UUID, or absolute local filesystem path may leave the process or persist unredacted. All persisted PR content MUST pass allowlist projection, `PIISanitizer`, `SecretScanner`, and `PathSanitizer`. Live responses and tool/validation errors MUST pass `SecretScanner` (and `PIISanitizer` where applicable). User-authored PR content returned to AI agents MUST be explicitly marked as untrusted data.

### IV. Bounded & Paged Tool Outputs (NON-NEGOTIABLE)
Every growing text payload MUST be bounded or paged (`offset` / `max_chars` via `PRContextService.page()` or explicit character caps), and every list or batch response MUST expose explicit `limit` / `offset` bounds or row caps so an MCP client's context budget cannot be overwhelmed by a single response.

### V. Disk Source of Truth, Atomicity & Relative Portability
The encrypted on-disk store (`ai-context/`) MUST be the sole source of truth for PR state—no process-wide in-memory PR caches may be written by MCP paths. Revision publication MUST follow stage → pre-write schema/integrity validation → atomic rename → `current.json` commit point last. All runtime paths MUST stay relative to the project root working directory set by `bin/cli.js`.

### VI. Frozen Contracts & Zero New Dependencies
The Schema v4 on-disk layout (`current.json`, `manifest.json`, `files.index.jsonl`, `commits.jsonl`, `coverage.json`, `files/<id>/change.json`, `patch.diff`, `file_NNNN`), the `PRC1` encryption header/magic, and the HKDF `INFO` string are frozen (only additive optional fields in zod schemas are permitted). No new npm dependency may be added without explicit justification in `docs/DEPENDENCIES.md`.

### VII. Configuration, Access Control & Encryption Gate
All configuration MUST come solely from environment variables read in `src/config/config.manager.ts` (loaded by `bin/cli.js` with precedence: process env > Hub `bitbucket` block > `.env`), never committed or logged. `ALLOWED_EMAILS` MUST be enforced on every CLI and MCP path. Every read/write under `ai-context/` MUST go through `secure-file.ts` after `AccessGate.unlock(workspace, repo)` verifies live repository access, and decrypted content MUST match its expected PR scope.

### VIII. Test-First & Ponytail Simplicity
Every fix MUST start with a failing test using `node:assert/strict` and a mocked `globalThis.fetch` (never hitting real Bitbucket). `npm test` runs each file in an isolated temp `cwd`; MCP tools MUST be tested end-to-end through `McpServer` + `Client` over `InMemoryTransport`. Prefer stdlib and existing helpers over new abstractions, and annotate intentional fixed limits with `// ponytail: <limit>, <upgrade path>`.

## Governance & Quality Gates

- **Authority**: This constitution encodes `AGENTS.md` §1–§2 and `docs/STANDARDS.md`; it supersedes convenience refactors.
- **Definition of Done**: `npx tsc --noEmit` and `npm run typecheck` MUST pass cleanly, `npm test` MUST print `✓ N test files passed`, `node bin/cli.js check` MUST pass, all invariant spot checks MUST pass, and `AGENTS.md` §2 documentation must be updated in the same commit.
- **Language**: Source code, comments, logs, error messages, and Markdown documentation MUST be in English.

**Version**: 1.0.0 | **Ratified**: 2026-11-12 | **Last Amended**: 2026-11-12
