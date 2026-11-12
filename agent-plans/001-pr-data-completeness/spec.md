# Feature Specification: Complete PR Data for AI Agents

**Feature Branch**: `001-pr-data-completeness`

**Created**: 2026-11-11

**Status**: Complete

**Input**: User description: "Keep commit-based PR data in the encrypted local cache, check the latest PR revision before data is used, refresh comments independently of commits, and give AI agents complete report-ready PR data through bounded MCP tools."

## User Scenarios & Testing

### User Story 1 - Read Current PR Data Without Re-downloading Unchanged Revisions (Priority: P1)

An AI agent starts a report or reads PR-specific cached data. The companion checks the PR's current source and destination commits, state, and draft status against the local revision. When those values match, it serves the encrypted local revision without fetching commits, diffstat, or diff again. When they differ, it syncs and validates the new revision before returning file data.

**Why this priority**: A report must not use stale file data, and unchanged PRs should avoid expensive full syncs.

**Independent Test**: Call a PR context or file-reading tool with unchanged and changed upstream commits. Confirm unchanged data causes only a metadata check and changed data is synced before the response.

**Acceptance Scenarios**:

1. **Given** a synced PR whose commits, state, and draft status match Bitbucket, **When** an agent reads PR data, **Then** the companion serves the local revision after a metadata check without downloading commits or diffs.
2. **Given** a synced PR whose source or destination commit, state, or draft status changed, **When** an agent reads PR data, **Then** the companion completes and validates a sync before returning data from the changed revision.
3. **Given** a metadata check is unavailable, **When** an agent reads PR data, **Then** the companion may serve the last local revision only with an explicit freshness warning.

---

### User Story 2 - Read a Fresh and Complete Review Snapshot (Priority: P1)

At the start of a report, an agent receives all available non-deleted comments, including replies and resolved threads, from a separately refreshed review snapshot. Comment data refreshes even when the PR commits have not changed. A failed or partial fetch never replaces the last complete snapshot silently.

**Why this priority**: Review feedback changes independently of commits and is central to the requested report.

**Independent Test**: Keep PR commits unchanged, change the Bitbucket comment response, request a new context pack, and verify the saved snapshot and comments tool reflect the new complete comment set.

**Acceptance Scenarios**:

1. **Given** unchanged PR commits and a newly added comment, **When** the agent starts a report, **Then** the new comment is fetched and appears in the encrypted review snapshot.
2. **Given** a complete existing review snapshot and a partial comment fetch, **When** a report is generated, **Then** the previous complete snapshot remains available and the response reports the failed refresh, its warning, and the snapshot age.
3. **Given** no previous complete snapshot and an incomplete initial fetch, **When** the agent requests comments, **Then** the result is explicitly incomplete and does not claim the available rows are the full review.
4. **Given** a review snapshot, **When** the agent reads its comments, **Then** every record preserves thread parent, author kind, optional author name, timestamp, resolved state, and inline location where available.

---

### User Story 3 - Retrieve Full Comment Text Safely (Priority: P2)

An agent can page through comment records and retrieve long comment bodies in bounded chunks without losing text to a fixed 4,000-character cap.

**Why this priority**: Long reviews must remain complete while each MCP response stays within a predictable size.

**Independent Test**: Store a comment longer than one response page, retrieve each page, and confirm concatenated text equals the full sanitized body.

**Acceptance Scenarios**:

1. **Given** comments longer than the list preview, **When** the agent reads the list, **Then** each truncated row includes total text length and a continuation offset.
2. **Given** a comment ID and continuation offset, **When** the agent requests a detail page, **Then** the response returns the next sanitized text chunk and its next offset or `null` at end.
3. **Given** a malformed or unknown comment ID, **When** the agent requests details, **Then** the tool returns an actionable sanitized error.

---

### User Story 4 - Attribute Review Feedback When Deployment Allows It (Priority: P2)

The agent can identify human or app commenters. Display names are included only when the deployment explicitly sets `PRIVACY_REMOVE_AUTHOR=false`; the global default remains hidden.

**Why this priority**: The user needs to identify leadership feedback while preserving the default privacy policy for other deployments.

**Independent Test**: Run the comment projection under both privacy settings and verify names appear only in the opted-in configuration.

**Acceptance Scenarios**:

1. **Given** default author-removal configuration, **When** comments are returned, **Then** no author display name is present and `author_kind` remains available.
2. **Given** `PRIVACY_REMOVE_AUTHOR=false`, **When** comments are returned, **Then** the sanitized author display name and `author_kind` are present.

## Edge Cases

- The PR head check succeeds but one or more comment pages fail.
- The PR head check is offline while the comment endpoint may still be reachable.
- A previously complete snapshot exists but its source commit differs from the current revision.
- The comment API reaches its page safety limit and reports incomplete pagination.
- A comment has no author, no inline path, a parent thread, or a resolved state.
- A long comment contains text that must be redacted before paging.
- A local review snapshot is missing, corrupt, tampered with, or encrypted under a different repository key.
- Two concurrent report requests refresh the same PR.

## Requirements

### Functional Requirements

- **FR-001**: Every PR-specific data read that relies on a local revision MUST check current source and destination commits, PR state, and draft status before returning data.
- **FR-002**: If the checked PR head matches the active local revision, the system MUST reuse that revision without fetching commits, diffstat, or diff.
- **FR-003**: If the checked PR head differs, the system MUST sync and validate the new revision before returning PR data.
- **FR-004**: A successful `get_pr_context_pack` call MUST fetch all available comment pages regardless of whether PR commits changed.
- **FR-005**: Review comments MUST be stored outside commit-bound `revisions/rev_*` in a separately versioned encrypted snapshot with an index and JSONL comment records.
- **FR-006**: The review index MUST record snapshot identity, fetch time, source revision, comment count, completeness, and sanitized warnings.
- **FR-007**: A partial or failed comment refresh MUST NOT replace the last complete snapshot. The response MUST identify the failed refresh and the age of any snapshot it serves.
- **FR-008**: The comments list tool MUST return complete/paged metadata and preserve author kind, optional author name, thread parent, timestamp, resolution state, inline file/line, and sanitized text.
- **FR-009**: Long comment text MUST be retrievable in bounded pages with total length and continuation offsets.
- **FR-010**: Author display names MUST remain hidden by default and MUST be returned only when `PRIVACY_REMOVE_AUTHOR=false`.
- **FR-011**: All comment text, author fields, paths, warnings, and tool errors MUST pass the existing privacy and secret sanitizers before persistence or return.
- **FR-012**: All review snapshot reads and writes MUST pass through the access gate and secure-file APIs; no raw review data may be written to plaintext files.
- **FR-013**: The change MUST preserve existing schema-v4 files and readers without migration.
- **FR-014**: Tools that can trigger local sync or write review snapshots MUST declare their cache-write side effects in MCP annotations and documentation.
- **FR-015**: The feature MUST NOT persist approvals or build statuses in the review snapshot.
- **FR-016**: The companion MUST NOT infer or add a severity field; the AI agent derives importance from sanitized comment text.

### Key Entities

- **PR Revision**: The commit-bound local snapshot containing PR metadata, commits, changed files, patches, and coverage.
- **Review Snapshot**: An independently refreshed, encrypted set of sanitized PR comments plus fetch metadata and completeness state.
- **Review Comment**: A comment record with ID, parent ID, optional author display name, author kind, creation time, resolved state, optional file/path/line, sanitized text, and paging metadata when displayed.
- **Freshness Check**: A Bitbucket metadata check comparing source/destination commits, state, and draft status with the active local revision.

## Success Criteria

### Measurable Outcomes

- **SC-001**: An unchanged PR data read performs a metadata check but no commits, diffstat, or diff request.
- **SC-002**: A changed source/destination commit, state, or draft status is reflected in a validated local revision before a tool returns file data.
- **SC-003**: Every complete comment fetch is represented by one complete encrypted snapshot, even when commits are unchanged.
- **SC-004**: An injected partial-fetch failure leaves the previous complete snapshot readable and reports the stale snapshot timestamp and current failure warning.
- **SC-005**: Concatenating all comment text pages yields the complete sanitized comment body with no missing or repeated characters.
- **SC-006**: Default privacy tests return no author display name; opt-in tests return the sanitized display name.
- **SC-007**: Existing schema-v4 fixtures and all current tests continue to pass without migration.

## Assumptions

- The existing context-pack-first agent workflow remains the report entry point; local file tools also guard against stale PR revisions.
- Comment snapshots include all non-deleted comments available from Bitbucket, including resolved comments and replies.
- Approval and build status behavior remains as currently implemented but is not added to the new persisted snapshot.
- Comment bodies and author names returned to agents remain subject to existing redaction; encryption at rest does not replace response sanitization.
- The user's Hub deployment will set `PRIVACY_REMOVE_AUTHOR=false`; all other installations keep the default `true`.
