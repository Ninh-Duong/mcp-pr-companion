# S9: Integration and verification (Wave 5)

**Goal:**
- Merge every session in order.
- Prove the whole system works end to end.
- Apply the doc changes that earlier sessions left in their Handoff notes.
- Close out the plan.

**Owned files:**
- Any file, but only to fix integration breaks or apply Handoff notes.
- `docs/ARCHITECTURE.md`, `docs/STANDARDS.md`
- `agent-plans/plan1/README.md` (status table)

**Branch:** `opt/S9-integration`, or the merge target the owner chooses.

## Steps

1. **Merge in wave order:** S1, S2, S3, S4, S5, then S6, S7 and S8.
   - Resolve conflicts in favour of the later wave. Its brief was written against the merged earlier waves.
   - After each merge, run `npx tsc --noEmit && npm test`. Stop and fix before the next merge.
2. **Handoff notes:** read the Handoff notes in every session file and apply them:
   - The privacy categories from S1 go into `docs/STANDARDS.md` / `docs/ARCHITECTURE.md`.
   - The diff cap from S3, the in-memory validation and flush from S4, and the single active-revision lookup and scope-checked reads from S6 go into `docs/ARCHITECTURE.md`.
   - Callers outside a session's ownership, such as `src/cmd/pr-detail.screen.ts` if `getPRDiffText` changed shape.
3. **Static checks:**
   - `npx tsc --noEmit`
   - `npm run typecheck` (added by S5)
   - `npm test` prints `✓ N test files passed`
   - `node bin/cli.js check` is all ✓
4. **Invariant spot checks:**
   - `grep -rn "console.log\|process.stdout" src/mcp src/core src/utils` finds nothing (invariant 1).
   - `grep -rn "fetch(" src` finds only `src/core/bitbucket/http.ts` (invariant 2).
   - `grep -rn "method:" src/core/bitbucket` finds nothing that is not a GET (invariant 2).
   - `grep -rn "process.env" src` finds only `src/config/` (invariant 9).
   - `grep -rn "readFileSync\|writeFileSync" src` shows no direct access under `ai-context/`; only `secure-file.ts` and `atomic.writer.ts` (invariant 11).
5. **Live smoke test through mcp-hub.**
   - This needs a configured `.env` and the hub. Plan with `hub__plan` using `playbook: pr-review`, or with servers `["mcp-pr-companion"]`.
   - `pr__list_my_open_prs` with `limit: 5` returns `total`, 5 `prs` and a `next_offset`, and the response is under 5 KB. Before Plan 1 this tool returned 549 PRs, about 186 KB.
   - `pr__get_pr_context_pack` on one real PR: the description and commits sit inside `<untrusted_pr_content>`, the Read Strategy is present, and the approvals and build lines are present.
   - `pr__get_pr_file_context` on one `Read next` file id: the diff sits inside `<untrusted_pr_content source="diff">`, with paging hints.
   - Call `pr__get_pr_context_pack` again within 120 s: it should be fast and its approvals line should read `not rechecked`.
6. **Hub:**
   - Confirm that `../mcp-hub/docs/mcps/mcp-pr-companion.md` matches the final tool parameters.
   - Restart the hub child, or run `uv run python scripts/smoke.py` in mcp-hub, so clients pick up the new `list_my_open_prs` schema.
7. **Close out:**
   - Update the status table in `agent-plans/plan1/README.md`: each session `done` with its commit hash, or `skipped` with the reason.
   - List any finding that is still open as a seed for `agent-plans/plan2/`. OPS-2 (retention of closed PRs) and path-bound AAD (header `v:2`) are the known ones.

## Definition of done (AGENTS.md §6)

1. `npx tsc --noEmit` is clean.
2. `npm test` reports `✓ N test files passed`.
3. `node bin/cli.js check` is all ✓.
4. Docs are updated per the AGENTS.md §2 map.
5. Commits are conventional; one per session, plus `docs: plan1 integration notes` if needed.

## Status / Handoff notes
_(filled by the agent)_
