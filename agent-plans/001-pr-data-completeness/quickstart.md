# Quickstart: Validate Complete PR Data

## Prerequisites

- Node.js >=20.12 and dependencies installed with `npm ci`.
- A test PR URL handled only by mocked Bitbucket responses in automated tests.
- A valid local repository access gate for manual MCP use.
- For author-name verification, set `PRIVACY_REMOVE_AUTHOR=false` in the isolated test environment; never use real credentials in tests.

## Automated checks

```powershell
npm test
npx tsc --noEmit
node bin/cli.js check
```

## Implementation run (2026-11-11)

- `npm test` — passed: 25 test files, 0 failures.
- `npx tsc --noEmit` — passed.
- `npm run build` — passed.
- `node bin/cli.js check` — ran and returned exit code 1 because this isolated worktree has no configured Bitbucket credentials/repository. It also reports dependencies out of date and the generated build stamp as stale; the worktree has dependencies installed for tests and `npm run build` succeeds. Do not add real credentials to make this local acceptance check pass.
- After the incomplete-first-fetch review fix, `npm test` again passed all 25 test files, `npx tsc --noEmit` passed, `npm run build` passed, and both companion and Hub `git diff --check` passed. The CLI check still reports the same environment/stamp limitation.

## Scenarios to verify

1. Call `get_pr_context_pack` for a new PR and verify the v4 revision and a complete encrypted review snapshot are published.
2. Call a PR-specific file reader with unchanged head hashes and verify the response is current without fetching commits, diffstat, or diff.
3. Change the mocked source commit and verify the next data read syncs the new revision before returning file data.
4. Keep commits unchanged but change comments; call the context pack and verify the refreshed snapshot is returned by `get_pr_comments`.
5. Make the comment fetch partial; verify the previously complete snapshot remains active and the response reports its timestamp and the current warning.
6. Read a comment longer than 4,000 characters through `get_pr_comment` pages and verify the full sanitized body is reconstructed exactly.
7. Verify default author removal and the opt-in author display path.
8. Inspect test temp storage to confirm sidecar bytes are encrypted and access-gate failures prevent reads.
