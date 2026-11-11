# Data Model: Complete PR Data for AI Agents

## PR Revision

The existing schema-v4 revision remains the source for commit-bound PR metadata, commits, file indexes, file changes, patches, coverage, and context output. No required field or path changes.

## Review Snapshot Index (schema version 1)

Stored encrypted at `live-review/snapshots/<snapshot_id>/index.json`.

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | integer (`1`) | Sidecar schema version, independent of v4. |
| `snapshot_id` | string | Unique immutable snapshot identifier. |
| `fetched_at` | ISO timestamp | Time the complete comment collection finished. |
| `source_commit` | string | Active PR source commit associated with the report. |
| `comment_count` | non-negative integer | Number of records in `comments.jsonl`. |
| `complete` | boolean | True only after all API pages were collected and the snapshot validated. |
| `warnings` | string array | Sanitized warnings associated with the snapshot; normally empty for a complete snapshot. |

## Last Refresh Attempt (schema version 1)

Stored separately as encrypted `live-review/last-attempt.json`. This metadata records the latest attempt without changing the current complete-snapshot pointer or comment contents.

| Field | Type | Meaning |
|---|---|---|
| `schema_version` | integer (`1`) | Sidecar attempt metadata version. |
| `attempted_at` | ISO timestamp | Time the latest comment refresh completed or failed. |
| `source_commit` | string | PR source revision used for the attempt. |
| `complete` | boolean | Whether all comment pages were collected successfully. |
| `warnings` | string array | Sanitized warnings; never raw Bitbucket error bodies. |
| `retained_snapshot_id` | string or `null` | Complete snapshot served after a partial attempt, if one exists. |

The attempt record contains no comment text. If refresh fails, the complete snapshot files and `current.json` remain unchanged; list/report responses combine the attempt warning with the retained snapshot's original fetch time and source commit.

## Review Comment Record

One JSON object per line in encrypted `comments.jsonl`, sorted by ascending Bitbucket comment ID.

| Field | Type | Meaning |
|---|---|---|
| `id` | integer | Bitbucket comment identifier. |
| `parent_id` | integer or `null` | Parent comment for a reply; null for a thread root. |
| `author` | optional string | Sanitized display name, present only when `PRIVACY_REMOVE_AUTHOR=false`. |
| `author_kind` | `person` or `app` | Commenter category. |
| `created_on` | ISO timestamp | Comment creation time. |
| `resolved` | boolean | Whether the review thread is resolved. |
| `file_id` | optional string or `null` | Matched local file ID when the PR is synced and paths are not opaque. |
| `path` | optional string | Sanitized inline path. |
| `line` | optional integer or `null` | Inline line number when available. |
| `text` | string | Full sanitized comment body; no fixed storage truncation. |

No severity field is added. Deleted comments remain excluded to preserve current behavior.

## Current Pointer

`live-review/current.json` contains `{ "snapshot_id": "..." }`. The pointer is atomically replaced only after the staged index and JSONL validate. Readers ignore temporary snapshot directories.

The sidecar is stored below the active PR status directory and is migrated with the PR directory when status changes. Migration preserves the newest valid complete encrypted snapshot and leaves the source directory intact if secure migration fails.

## MCP Page Models

- `get_pr_comments`: `{snapshot_id, fetched_at, source_commit, total, complete, warnings, refresh_attempt?, comments, next_offset}`. These metadata values are nullable when no complete snapshot exists. Each list row includes a 4,000-character text preview, `text_total_chars`, and `text_next_offset` when more text exists. After an incomplete initial refresh, the tool returns `complete=false`, no comment rows, `snapshot_id=null`, and the sanitized attempt warning; partial rows are never presented as the complete review. If there has been no refresh attempt, it returns an actionable instruction to call `get_pr_context_pack`.
- `get_pr_comment`: input `{pr_url, comment_id, snapshot_id?, offset, max_chars}`; `snapshot_id` from the first page is required for every continuation (`offset > 0`). Output `{snapshot_id, comment, text, total_chars, next_offset, warnings}`. A continuation whose snapshot is no longer current fails with restart instructions rather than mixing body versions.

All response text/path/author/warning values are sanitized before leaving the process.
