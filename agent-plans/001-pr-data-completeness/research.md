# Research: Complete PR Data for AI Agents

## Decision 1: Keep commit-bound revisions separate from reviews

**Decision**: Preserve the existing `revisions/rev_<src7>_<dst7>` tree and add an independently versioned `live-review` sidecar under the PR directory.

**Rationale**: Comments change without commit changes. Mixing them into a commit-keyed revision would make review freshness ambiguous and alter schema-v4 revision lifecycle/retention.

**Alternatives considered**:
- Store comments inside the active revision: rejected because comment updates would require replacing a revision with an unchanged commit identity.
- Store one unstructured Markdown bundle: rejected because it is harder to validate, filter, and page.

## Decision 2: Check PR head before each PR-specific local read

**Decision**: Reuse `PRContextService.ensureFresh`, disable its default freshness window by setting the default TTL to `0`, and invoke it before specific-PR readers. Compare source/destination hashes, state, and draft status; only a mismatch triggers full sync.

**Rationale**: This follows the user's requested pre-use check while avoiding full downloads for unchanged PRs. A metadata GET is cheaper than fetching commits and diffs.

**Alternatives considered**:
- Keep the 120-second default TTL: rejected because a pushed commit can remain unnoticed within the window.
- Always download the full revision: rejected because it wastes bandwidth and work when the head is unchanged.

## Decision 3: Refresh comment snapshot at report start

**Decision**: Every `get_pr_context_pack` fetches all available comment pages regardless of commit changes. It publishes a new snapshot only after complete pagination and validation. `get_pr_comments` reads pages from the saved snapshot; it does not refetch each page.

**Rationale**: Comment records can change independently from commits. Fetching once per report keeps all pages consistent and avoids repeated Bitbucket collection for each MCP page.

**Alternatives considered**:
- Refresh comments only when their count changes: rejected because edits/resolution changes can leave the count unchanged.
- Refresh comments on every page request: rejected because pages could come from inconsistent snapshots and every page would redownload all comments.

## Decision 4: Retain the last complete snapshot on failure

**Decision**: A failed or incomplete comment fetch leaves the current complete snapshot pointer unchanged. The report returns the stale snapshot's `fetched_at`, its source commit, and the sanitized current fetch warning. If no complete snapshot exists, return no comment rows with `complete=false`.

**Rationale**: Partial data must not replace or masquerade as complete data, and agents need an explicit way to judge staleness.

**Alternatives considered**:
- Publish partial pages as current: rejected because this discards complete data and increases the chance an agent treats a partial review as complete.
- Hide errors and serve cache silently: rejected because it would mislead report generation.

## Decision 5: Preserve privacy opt-in and bounded MCP output

**Decision**: Keep `PRIVACY_REMOVE_AUTHOR=true` globally. The user's Hub child may set it to `false`. Store complete sanitized comment text and expose long bodies through a paged `get_pr_comment` tool.

**Rationale**: The feature needs reviewer attribution without changing defaults for other deployments. Bounded response pages preserve the MCP context budget.

**Alternatives considered**:
- Expose all authors by default: rejected because it changes privacy behavior globally.
- Keep a permanent 4,000-character cap: rejected because agents cannot retrieve the rest of long comments.
- Add an inferred severity field: rejected because comment severity is not consistently structured; the AI agent should interpret the full sanitized text.

## Decision 6: Do not persist approvals/build statuses

**Decision**: Keep current approvals/build behavior and exclude them from the new sidecar.

**Rationale**: The user requested comments/review detail storage and explicitly excluded approvals/build status from the snapshot.
