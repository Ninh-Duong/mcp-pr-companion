# MCP Contract: PR Review Comments

## Report entry point

`get_pr_context_pack(pr_url, refresh?)` checks the current PR source/destination commits, state, and draft flag before returning report context. It attempts a full comment refresh on every report, including when commits are unchanged. If the head check is unavailable, it reports the cached revision as unverified and still attempts comment refresh.

## List comments

`get_pr_comments(pr_url, include_resolved=true, offset=0, limit=50)` reads the latest complete encrypted review snapshot after the repository access check. It does not make a new comment fetch for each page. If the first refresh attempt was incomplete and no complete snapshot exists, it returns `complete=false`, `snapshot_id=null`, nullable snapshot metadata, an empty `comments` list, and the sanitized attempt warning. It never returns partial rows as if they were the full review. Before any refresh attempt, it returns an actionable instruction to call `get_pr_context_pack`.

Response JSON:

```json
{
  "snapshot_id": "opaque-id",
  "fetched_at": "ISO-8601 timestamp",
  "source_commit": "commit hash",
  "total": 0,
  "complete": true,
  "warnings": [],
  "refresh_attempt": {
    "attempted_at": "ISO-8601 timestamp",
    "complete": false,
    "warnings": ["Comment refresh failed: sanitized reason", "Serving retained snapshot from ... (age ...s, source ...)."],
    "source_commit": "commit hash used for the attempt",
    "retained_snapshot_id": "opaque-id"
  },
  "comments": [],
  "next_offset": null
}
```

Each comment includes `id`, `parent_id`, `author_kind`, `created_on`, `resolved`, optional `author`, optional inline `file_id`/`path`/`line`, a text preview, `text_total_chars`, and optional `text_next_offset`. Author is returned only when configured; default configuration omits it. A stale snapshot fallback is identified by `warnings`, the failed `refresh_attempt`, and the original `fetched_at`/`source_commit`.

## Read long comment text

`get_pr_comment(pr_url, comment_id, snapshot_id?, offset=0, max_chars=16000)` returns one sanitized text page. `max_chars` is bounded from 500 to 100,000. The first page returns `snapshot_id`; every continuation (`offset > 0`) must pass that ID. If a report refresh creates a newer snapshot, the old continuation fails with instructions to restart at offset 0 instead of mixing comment-body versions. Response JSON includes `snapshot_id`, comment metadata, `text`, `total_chars`, `next_offset`, and `warnings`.

## Errors and side effects

- A missing review snapshot with no recorded refresh attempt returns an actionable instruction to call `get_pr_context_pack` first.
- A missing review snapshot after a recorded incomplete first fetch returns an explicit incomplete response with no rows and the sanitized warning.
- A corrupt/tampered snapshot is rejected by secure-file authentication and never bypassed with plaintext reads.
- A partial refresh preserves the previous complete snapshot and records an encrypted last-attempt warning without advancing the snapshot pointer. Subsequent `get_pr_comments` responses include the sanitized warning plus the retained snapshot's original `fetched_at` and `source_commit`.
- `get_pr_context_pack` can write encrypted local cache. PR-specific local readers can check freshness and sync a changed revision, so their `readOnlyHint` is false and `openWorldHint` is true.
- The tool never writes to Bitbucket.
