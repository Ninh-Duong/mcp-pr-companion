<!--
Sync Impact Report
Version: none -> 1.0.0
Modified principles: initial constitution derived from the existing AGENTS.md invariants
Added sections: security and data handling; development and review gates
Removed sections: none
Follow-up: keep detailed agent procedures in AGENTS.md
-->

# mcp-pr-companion Constitution

## Core Principles

### I. Bitbucket Access Is Read-Only

The companion MUST issue only read requests to Bitbucket. All network calls MUST pass through the shared Bitbucket client and retry/pagination controls. The token MUST use only the documented read scopes.

### II. Sanitize Data and Encrypt Local PR Content

No unsanitized PR content, secrets, credentials, or private file paths may leave the process. Every file under `ai-context/` MUST use the secure-file APIs after a successful access-gate check. Raw Bitbucket responses MUST NOT be persisted or returned.

### III. Bound Output and Report Completeness

Growing text and collections MUST be paged or capped. Responses MUST distinguish complete data from partial, stale, or unavailable data and MUST surface warnings rather than imply completeness.

### IV. Preserve the Version 4 Storage Contract

Existing schema-v4 filenames, required fields, revision IDs, encryption format, and publication ordering are compatibility invariants. New data MUST be additive and independently versioned where it is not commit-bound; current revisions MUST remain readable without migration.

### V. Test Behavior Before Implementation

Behavior changes MUST start with a test that fails for the missing behavior. Changes to tool contracts, storage, encryption, pagination, or sync behavior MUST include focused integration or contract tests and documentation updates.

### VI. Prefer the Smallest Maintainable Change

Reuse existing modules and standard-library capabilities before introducing abstractions or dependencies. Dependencies require an explicit rationale in `docs/DEPENDENCIES.md`. Paths remain relative to the repository root.

## Security and Data Handling

- Author display names remain hidden by default. Any author disclosure MUST be an explicit deployment configuration and MUST continue to sanitize the associated comment content.
- Tools that can write local cache data MUST declare that side effect in their MCP annotations.
- Logs and errors MUST not expose tokens, raw API responses, repository UUIDs, or unredacted secrets.

## Development and Review Gates

- Tests run in isolated temporary working directories and MUST NOT contact the real Bitbucket API.
- Every changed tool contract MUST be reflected in `src/mcp/tools.ts`, the README, the child integration guide, and the mcp-hub child contract.
- Before completion, run `npm test`, `npx tsc --noEmit`, and `node bin/cli.js check`; report any environment-dependent result accurately.

## Governance

This constitution distills the existing repository invariants in `AGENTS.md`; it does not replace that operating manual. Changes to these principles require a documented Spec Kit amendment and a version bump: MAJOR for incompatible governance changes, MINOR for new or materially expanded principles, and PATCH for clarification. Feature plans and reviews MUST identify conflicts with these principles before implementation.

**Version**: 1.0.0 | **Ratified**: 2026-11-11 | **Last Amended**: 2026-11-11
