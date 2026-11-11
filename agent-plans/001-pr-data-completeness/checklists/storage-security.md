# Storage and Privacy Checklist

- [x] Snapshot index, comment JSONL, and last-attempt metadata are encrypted through secure-file APIs.
- [x] AccessGate unlock is required before every snapshot read/write; secure-file reads/writes fail without unlocked key material.
- [x] Snapshot records contain sanitized data only; raw Bitbucket payloads are never persisted.
- [x] Invalid/incomplete snapshots cannot replace the current complete pointer; injected publication and migration failures preserve the old pointer/source.
- [x] Existing schema-v4 revisions remain readable with no migration.
- [x] Default author removal omits `author`; explicit false includes only sanitized display name.
- [x] Corrupt/tampered snapshot fails closed and creates no plaintext fallback.
- [x] Warnings/errors are sanitized before returning to MCP clients and are encrypted in last-attempt metadata.

**Evidence**: `npm test` passed all 25 test files; `npx tsc --noEmit` passed. Storage cases cover encrypted bytes, authentication failure, malformed JSONL, partial publication, pointer rollback, and status-migration attempt selection.
