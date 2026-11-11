# MCP Contract Checklist

- [x] PR-specific data readers check commits/state/draft before serving the revision by default (`FRESHNESS_TTL_SECONDS=0`).
- [x] Unchanged PR heads do not trigger commits, diffstat, or diff downloads.
- [x] Changed PR heads sync and validate before data is returned.
- [x] Context-pack requests refresh all available comment pages even when commits are unchanged or metadata freshness is unavailable.
- [x] Comment list responses include snapshot identity, time, completeness, warnings, refresh-attempt metadata, and paging metadata.
- [x] Long comment bodies can be reconstructed exactly through bounded pages; continuations are pinned to `snapshot_id`.
- [x] Authors are hidden by default and visible only under the configured opt-in.
- [x] Tool annotations accurately identify calls that can sync or write encrypted cache.
- [x] Companion and mcp-hub contracts describe the same workflow and schemas.

**Evidence**: `npm test` passed all 25 test files; `npx tsc --noEmit` passed. Hub docs QC and JSON parse also passed after the contract update.
