# Feature Specification: Plan 1 Review Remediation & Performance Optimization

**Feature Branch**: `001-plan1-optimization`

**Created**: 2026-11-12

**Status**: Draft

**Input**: User description: "Implement agent-plans/plan1 review fixes and multi-agent performance optimizations under SpecKit standards."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Secret Redaction & Cryptographic Scope Protection (Priority: P1)

As an engineering team connecting AI agents to private Bitbucket repositories, I want all credential formats, error bodies, validation failures, and encrypted cache reads to enforce strict sanitization and PR-level scope verification so that sensitive secrets, internal filesystem paths, or cross-PR files can never leak or be swapped.

**Why this priority**: Security and privacy violations (leaking secrets like `DB_PASSWORD`, raw API error bodies, or absolute local paths) directly compromise repository confidentiality and violate core project guarantees.

**Independent Test**: Pass synthetic lines containing prefixed passwords, secret assignments, Slack webhooks, and raw 401 error payloads through sanitization and pagination warning paths; verify every secret is masked while ordinary code constructs stay intact. Attempt to read an encrypted file belonging to one PR/repository under a different PR/repository scope and verify decryption fails cleanly.

**Acceptance Scenarios**:

1. **Given** diff lines or metadata containing prefixed password assignments, secret/token/key assignments, or Slack webhook URLs, **When** content is sanitized, **Then** secret values are replaced by redaction markers while template placeholders, function calls, comparisons, and type declarations remain unaltered.
2. **Given** an upstream HTTP error response whose body contains a bearer credential, **When** paginated fetching stops and records a warning, **Then** the warning message is sanitized before truncation so partial tokens cannot escape.
3. **Given** an encrypted cache file belonging to PR A or repository A, **When** a reader attempts to open it expecting PR B or repository B, **Then** decryption fails with the standard access/tampering error without exposing scope details.
4. **Given** an invalid revision staging check (e.g., missing manifest or index files), **When** validation reports errors, **Then** error messages contain relative filenames without exposing local absolute directory paths.

---

### User Story 2 - Fast, Bounded Upstream Collection & Storage I/O (Priority: P1)

As a user syncing large pull requests or querying cached PR context through an AI assistant, I want upstream API collection, disk writes, freshness checks, and local cache reads to minimize round trips, memory growth, fsync latency, and repeated decryption passes so syncs and tool calls complete quickly without blocking.

**Why this priority**: Large diffs without size caps exhaust memory, per-file synchronous disk flushes stall the stdio event loop, and quadratic re-sync/read lookups cause noticeable multi-second delays.

**Independent Test**: Sync a multi-file PR twice with a spy counting validation reads and `fs.fsyncSync` calls, verify in-memory pre-write validation eliminates post-write decryption, verify single-digit directory flushes on write, verify single active-revision resolution per MCP call, and verify O(F) patch diffing on re-sync.

**Acceptance Scenarios**:

1. **Given** a pull request diff exceeding the maximum byte budget (20 MB), **When** the client downloads the diff, **Then** it aborts the stream early, preserves complete lines up to the boundary, marks diff coverage as partial, and records a truncation warning.
2. **Given** transient network socket errors (`ECONNRESET`, `ETIMEDOUT`, etc.), **When** a Bitbucket GET request fails without caller cancellation or per-attempt timeout, **Then** the client retries up to the configured retry limit; already-aborted caller signals fail immediately.
3. **Given** concurrent access checks for the same repository on a cold cache, **When** multiple operations call unlock simultaneously, **Then** only one upstream repository metadata request is issued; failed checks are not cached.
4. **Given** a new PR revision write, **When** validation and persistence run, **Then** schema and cross-reference integrity are validated in memory before writing to staging, staged files flush per directory rather than per file, and `current.json` remains the final durable commit point.
5. **Given** a synced PR on disk, **When** a user invokes context, file detail, file change, or file search operations, **Then** the active revision is resolved at most once per call, directory probes skip missing `current.json` folders before decryption, and re-sync compares previous patches in a single linear pass.

---

### User Story 3 - Bounded MCP List Outputs & Untrusted Content Isolation (Priority: P1)

As an AI agent operating under a shared tool hub with SQL, log, and issue-tracker capabilities, I want PR discovery listings and sync summaries to have deterministic bounded pages and all user-authored PR text to carry explicit untrusted-data boundaries so prompts stay within context budgets and PR text cannot inject instructions.

**Why this priority**: Unbounded listings (e.g., 549 open PRs returning ~186 KB in a single call) blow up LLM context budgets, and unmarked PR descriptions/comments/diffs expose downstream tools to prompt injection.

**Independent Test**: Invoke `list_my_open_prs` against 120 open PRs with default and custom `offset`/`limit` values; invoke `sync_my_open_prs` against 80 unchanged PRs; invoke `get_pr_context_pack`, `get_pr_file_context`, and `get_pr_comments` on PRs containing malicious closing tags and inspect delimiter escaping and `content_trust` flags.

**Acceptance Scenarios**:

1. **Given** 120 open pull requests authored by the configured account, **When** `list_my_open_prs` is called with default arguments, **Then** it returns `total: 120`, 50 deterministically sorted items, and `next_offset: 50`; passing `limit > 200` is rejected.
2. **Given** 80 unchanged open pull requests during `sync_my_open_prs`, **When** synchronization completes, **Then** the returned `prs` array includes all synced/failed rows plus at most 50 unchanged rows along with an `omitted_unchanged: 30` counter.
3. **Given** multiple configured repositories, **When** MCP discovery runs, **Then** repositories are queried concurrently in deterministic output order without writing PR titles or state into process-wide in-memory discovery caches.
4. **Given** user-authored PR descriptions, commit lists, diffs, build status strings, and review comments, **When** formatted into Markdown context packs or file details, **Then** each untrusted region is wrapped in `<untrusted_pr_content source="...">...</untrusted_pr_content>` with inner matching tags escaped, `get_pr_comments` includes `content_trust: "untrusted"`, and server instructions explicitly warn agents never to follow instructions inside untrusted blocks.

---

### User Story 4 - Configuration Hygiene, Log Retention & Reliable Test Suite (Priority: P2)

As a maintainer operating the server and running CI across Windows, macOS, and Linux, I want environment variables fully documented and routed through a single config manager, dated CLI log directories automatically pruned, dependency installation hardened, and the full test suite running reliably and fast with strict assertions.

**Why this priority**: Incomplete config docs, unbounded CLI log folders, fail-fast test masking, and gaps in auth/generation coverage slow down diagnosis and allow regressions to slip through.

**Independent Test**: Run `FileLogger` with dated folders older and newer than `LOG_RETENTION_DAYS`; verify `Logger.debug` reads `ConfigManager`; run auth probe and generation batch unit tests against mocked HTTP errors; execute the test runner with a synthetic failing test and verify all remaining files still execute and report aggregate failures.

**Acceptance Scenarios**:

1. **Given** `FRESHNESS_TTL_SECONDS`, `LOG_RETENTION_DAYS`, and `DEBUG` configuration values, **When** settings are read and documented, **Then** all values flow through `ConfigManager` and appear clearly in `.env.example` and README config tables (with individual rows for each `PRIVACY_*` variable).
2. **Given** dated `Logs/YYYY-MM-DD/` folders older than `LOG_RETENTION_DAYS` (default 14), **When** `FileLogger` initializes, **Then** expired date folders are pruned while today's folder, non-date folders, and `Logs/mcp-server.log*` remain untouched.
3. **Given** `package.json` and `bin/cli.js`, **When** type-checking and clean dependency setup run, **Then** `npm run typecheck` checks both `src` and `tests`, and `bin/cli.js` skips install scripts via `--ignore-scripts` if verified safe with all dependencies.
4. **Given** the automated test suite, **When** `npm test` runs, **Then** every `tests/*.test.ts` file executes in its own isolated temp directory regardless of earlier failures, legacy custom counters use `node:assert/strict`, `Date.now` mocks always restore in `finally`, `http.test.ts` avoids real 1-second wall sleeps, and direct unit tests cover `AuthService`, `CapabilityProbe`, `FileLogger` pruning, and `GenerationManager`.

---

### User Story 5 - Modular MCP Service Decomposition (Priority: P3)

As a developer maintaining `src/mcp/`, I want the 500-line `PRContextService` monolith cleanly split into focused modules with shared text-redaction helpers and zero dead code while preserving the existing public static API and passing every existing test untouched.

**Why this priority**: Separating freshness, live review formatting, discovery/batch sync, and sanitized text helpers improves long-term maintainability without changing external behavior.

**Independent Test**: Run the full test suite before and after the refactor with zero modifications to any test file (`git diff --stat tests/` empty), confirm no circular imports, and confirm every `src/mcp/*.ts` module stays compact (`<= 250` lines).

**Acceptance Scenarios**:

1. **Given** the complete passing test suite after Stories 1–3, **When** `PRContextService` internals are split into focused modules (`text`, `freshness`, `review-live`, `my-prs`, and `context.service` facade), **Then** all tests pass without editing any test file and no `src/mcp/*.ts` file exceeds ~250 lines.
2. **Given** repeated error/text sanitization lambdas and unused aliases/methods (`type Head`, `DiscoveryCache.clear()`), **When** cleanup completes, **Then** shared helpers eliminate duplication and dead symbols are removed.

---

### Edge Cases

- What happens when `generic_secret` encounters a valid short literal like `SECRET_NAME=prod/db` (7 chars) vs. code identifiers like `const token = getToken();` or TypeScript properties like `password_hash: string;`? Short assignment literals matching secret key patterns are redacted (explicitly accepted trade-off), while function invocations and type annotations remain intact.
- What happens when a PR diff has no hunks (e.g., pure rename/mode change)? Reconstructed patch output MUST retain byte-for-byte identity (`headerLines.join('\n') + '\n'`).
- What happens when a repository directory under `ai-context/` has no `current.json` or an unencrypted legacy file? Directory probing filters missing `current.json` directories before any decryption attempt, and unencrypted legacy files continue returning null/`PlaintextFileError` for re-sync.
- What happens if Windows raises `EISDIR` or `EPERM` when flushing a directory handle? Directory `fsync` safely ignores OS-unsupported directory fsyncs and relies on NTFS journaling for the re-creatable cache, while `current.json` always uses an fsynced file write.
- What happens when `untrusted_pr_content` text itself contains literal `<untrusted_pr_content>` or `</untrusted_pr_content>` tags? Opening/closing tag prefixes inside the text are HTML-escaped (`&lt;`) so the outer delimiter block cannot be prematurely closed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST redact prefixed password assignments, general secret/token/key assignments, and Slack webhook URLs while preserving variable substitutions (`${...}`, `$(...)`, `{{...}}`, `process.env`), function calls, comparisons, and TypeScript primitive type annotations.
- **FR-002**: System MUST sanitize pagination error bodies (prior to length truncation) and caught network error messages through `SecretScanner` before storing warnings or returning them.
- **FR-003**: System MUST verify decrypted file headers against the caller's expected `(workspace, repoSlug, prId)` scope (case-insensitive workspace/repo) whenever a scope is provided, throwing the standard decryption error on mismatch without revealing scope details.
- **FR-004**: System MUST update encryption threat-model documentation to state clearly that deriving the key from the repository UUID prevents casual reading without Bitbucket access, not confidentiality against holders of `.env` or public-repo UUIDs.
- **FR-005**: System MUST deduplicate concurrent `AccessGate.unlock(workspace, repoSlug)` calls in flight per repository and MUST NOT cache failed unlock attempts.
- **FR-006**: System MUST retry transient network errors (`ECONNRESET`, `ETIMEDOUT`, `ECONNREFUSED`, `EAI_AGAIN`, `UND_ERR_SOCKET`, `UND_ERR_CONNECT_TIMEOUT`) up to the retry cap, MUST NOT retry caller-aborted signals or per-attempt `TimeoutError`s, and MUST expose an injectable timing seam for fast tests.
- **FR-007**: System MUST consolidate Bitbucket repository URL construction, request `pagelen=100` for commits and diffstat endpoints, cap downloaded diff streams at 20 MB cleanly on a newline boundary, and record `coverage.diff = 'partial'` with a warning when truncated.
- **FR-008**: System MUST eliminate absolute filesystem paths from revision validation error messages.
- **FR-009**: System MUST validate revision manifest, coverage, file index, and file changes in memory before writing staging files, skipping redundant post-write decryption during normal `writeRevision` while retaining disk-based validation for directory migration.
- **FR-010**: System MUST minimize `fsync` calls during revision staging by flushing written staging directories (including `files/<id>.md` staging) once per directory before atomic rename while keeping `current.json` and top-level outputs atomically fsynced.
- **FR-011**: System MUST accept a structured options object (`WriteRevisionInput`) in `RevisionWriter.writeRevision` across all callers.
- **FR-012**: System MUST document and route `FRESHNESS_TTL_SECONDS`, `LOG_RETENTION_DAYS`, `DEBUG`, and distinct `PRIVACY_*` settings exclusively through `ConfigManager` / `config.schema.ts`, `.env.example`, and `README.md`.
- **FR-013**: System MUST prune `Logs/YYYY-MM-DD/` CLI log directories older than `LOG_RETENTION_DAYS` (default 14, `0` disables) while never deleting `Logs/mcp-server.log*` or non-date folders.
- **FR-014**: System MUST execute every `tests/*.test.ts` file even when an earlier file fails, report all failing files, preserve `✓ N test files passed` on success, add `npm run typecheck`, standardize assertions on `node:assert/strict`, guard all `Date.now` overrides in `try/finally`, and verify `--ignore-scripts` compatibility in `bin/cli.js`.
- **FR-015**: System MUST resolve the active PR revision at most once per MCP tool call, probe `current.json` existence before decrypting directories, resolve explicit `revisionId` directories without calling `getActiveRevision`, and bind every `OutputReader` decryption to the PR's `SecureScope`.
- **FR-016**: System MUST compare previous revision patches in linear $O(F)$ time during re-sync (`diffAgainstActive`), assemble patch text without quadratic string concatenation (`PERF-9`), and accumulate tag/thread collections in place.
- **FR-017**: System MUST add bounded `offset` (default 0) and `limit` (default 50, max 200) paging and deterministic sorting to `list_my_open_prs`, and cap `unchanged` rows at 50 (reporting `omitted_unchanged`) in `sync_my_open_prs`.
- **FR-018**: System MUST parallelize MCP repository discovery across configured targets in deterministic order without populating `DiscoveryCache` on the MCP path, while deduplicating target validation.
- **FR-019**: System MUST wrap untrusted PR fields (`description`, `commits`, `diff`, `comments`, `build_status`) in `<untrusted_pr_content source="...">...</untrusted_pr_content>` with inner tags escaped, include `content_trust: "untrusted"` in `get_pr_comments`, update `INSTRUCTIONS` (< 1,500 chars), and synchronize `AGENTS.md`, `README.md`, and `docs/HUB_INTEGRATION.md`.
- **FR-020**: System MUST decompose `PRContextService` into cohesive `src/mcp/` modules with shared error/text sanitization helpers and remove dead code (`type Head`, `DiscoveryCache.clear()`) with zero test behavior changes.

### Key Entities

- **SecureScope**: `{ workspace, repoSlug, prId }` tuple used to bind `PRC1` decryption operations to the expected PR and repository.
- **WriteRevisionInput**: Named options payload replacing 14 positional arguments on `RevisionWriter.writeRevision`.
- **RevisionData**: In-memory representation of manifest, coverage, index lines, and file changes validated prior to staging writes.
- **ActiveRevisionResult**: Single-lookup resolution bundle (`prDir`, `current`, `manifest`) reused across all reads within one MCP tool invocation.
- **UntrustedContentBlock**: Delimited `<untrusted_pr_content source="...">` envelope protecting agents from prompt injection inside PR text.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `npx tsc --noEmit`, `npm run typecheck`, `npm run build`, and `npm test` pass with zero errors and report `✓ N test files passed` across all existing plus new test suites (`access-gate`, `auth`, `generation`, `logging`, `read-path`).
- **SC-002**: A 50-file PR re-sync performs `<= 52` file reads for previous patches (reading `current.json` and `manifest.json` at most once each instead of ~50 times), and `get_pr_file_context` / `get_pr_file_changes` perform `<= 3` / `<= 4` decryptions inside the freshness TTL.
- **SC-003**: Writing a 10-file PR revision invokes `RevisionValidator.validate` `0` times and reduces `fs.fsyncSync` calls to `<= 12` (down from `>= 28` before optimization).
- **SC-004**: `list_my_open_prs` with 120 open PRs returns 50 rows by default (`limit` capped at 200), keeping typical page size bounded well within context budgets, and `sync_my_open_prs` with 80 unchanged PRs returns `<= 50` `prs` rows plus `omitted_unchanged: 30`.
- **SC-005**: All 5 repository invariant spot checks (`stdout` purity, single `fetch` GET-only HTTP path, `process.env` centralization, `ai-context/` encryption exclusivity, and `< 1,500` char `INSTRUCTIONS`) pass with zero violations.

## Assumptions & Out of Scope

- **Deferred (`OPS-2`)**: Automated pruning of `merged`/`declined` PR directories under `ai-context/` deletes user data and remains deferred pending an owner retention policy.
- **Deferred (`PRC1 v: 2`)**: Path-bound AAD requires a `PRC1` header version bump and stays documented as an upgrade path rather than implemented now.
- **External (`OPS-3` & sibling `../mcp-hub`)**: `mcp-jira-sync` log redaction and committing edits in the sibling `../mcp-hub` repository lie outside this workspace; contract updates for `../mcp-hub` are documented as a handoff patch.
