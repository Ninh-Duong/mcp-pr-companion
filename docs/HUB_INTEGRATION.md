# Running under mcp-hub

[mcp-hub](../../mcp-hub) launches this repository as a local stdio child and exposes an allowlisted set of its tools to AI clients. The hub-side contract is `../mcp-hub/docs/mcps/mcp-pr-companion.md`. The shared rules every child must follow are in `../mcp-hub/docs/child-mcp-compatibility.md`, and the onboarding runbook is `../mcp-hub/docs/adding-a-child-mcp.md`.

## 1. Requirements

- The repo sits next to the hub: `<parent>/mcp-hub` and `<parent>/mcp-pr-companion`.
- `BITBUCKET_EMAIL` and `BITBUCKET_API_TOKEN` are set in the hub's `bitbucket` block (see §2) or in this repo's `.env`.
- `BITBUCKET_REPOSITORY` (with `BITBUCKET_WORKSPACE` for entries without a `workspace/` part) is optional for the MCP server when calls provide `pr_url` or `repository`. Set it for `list_my_open_prs`, `list_synced_prs`, or `sync_my_open_prs` when `repository` is omitted, for `AUTO_SYNC_ON_START`, and for `node bin/cli.js check`, which requires it.
- `BITBUCKET_REPOSITORY` is also required by `node bin/cli.js sync <mode>`; the command syncs owned PRs across every configured repository.
- Run `node bin/cli.js prepare` once (it runs `npm ci` and the build), then `node bin/cli.js check`, which should be all ✓. A cold first start inside the hub would otherwise spend its first call on installing.

## 2. Child config (`config/private/mcps/mcp-pr-companion.json` in the hub)

Copy the hub template `config/mcps/mcp-pr-companion.example.json`:

```json
{
  "transport": "stdio",
  "command": "node",
  "args": ["bin/cli.js", "server"],
  "cwd": "../mcp-pr-companion",
  "inheritEnv": ["PATH", "PATHEXT", "COMSPEC", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "USERPROFILE", "APPDATA", "LOCALAPPDATA"],
  "timeoutSeconds": 300,
  "env": {}
}
```

- `inheritEnv` includes `APPDATA`, `LOCALAPPDATA`, `PATHEXT` and `COMSPEC` so that `npm` works when the launcher has to install or rebuild on Windows.
- `timeoutSeconds: 300` covers a full sync of a large PR (diff download allows up to 45 s, plus pagination).
- To override a setting for the hub only (for example `PRIVACY_FILE_PATH_MODE`), put it in `env`. Never put the token there.

### Credentials from the hub (`CENTRAL_CONFIG_PATH`)

The hub passes `CENTRAL_CONFIG_PATH` (for example `../mcp-hub/config/private/mcps/mcp-pr-companion.json`). `bin/cli.js` resolves a relative path against this repo's root, not the cwd, and reads only the file's `bitbucket` block:

```json
"bitbucket": { "email": "", "api_token": "", "workspace": "", "repository": "", "allowed_emails": "" }
```

| Hub field | Env variable |
|---|---|
| `email` | `BITBUCKET_EMAIL` |
| `api_token` | `BITBUCKET_API_TOKEN` |
| `workspace` | `BITBUCKET_WORKSPACE` |
| `repository` | `BITBUCKET_REPOSITORY` |
| `allowed_emails` | `ALLOWED_EMAILS` (a string, or an array joined with `,`) |

- Priority per value: process env > hub `bitbucket` block > this repo's `.env` > default. Empty strings count as unset.
- Without `CENTRAL_CONFIG_PATH` (standalone), only `.env` applies, as before.
- A missing or broken hub file, or one without a `bitbucket` block, logs a launcher warning (stderr and `Logs/mcp-server.log`) and `.env` is used. The child never writes the hub file.
- `node bin/cli.js check` and `check_bitbucket_connection` report each group's source (`env`, `hub`, `local`, `unset`): never values, never the hub file path. `credentials` is the source of `BITBUCKET_API_TOKEN`.

## 3. Registration (`config/private/hub.json` in the hub)

```json
"servers": {
  "mcp-pr-companion": { "enabled": false, "configFile": "config/private/mcps/mcp-pr-companion.json" }
},
"features": {
  "pr": {
    "enabled": false,
    "tools": [
      { "server": "mcp-pr-companion", "name": "get_pr_context_pack", "exposeAs": "pr__get_pr_context_pack" },
      { "server": "mcp-pr-companion", "name": "search_pr_files", "exposeAs": "pr__search_pr_files" },
      { "server": "mcp-pr-companion", "name": "get_pr_file_context", "exposeAs": "pr__get_pr_file_context" },
      { "server": "mcp-pr-companion", "name": "get_pr_file_changes", "exposeAs": "pr__get_pr_file_changes" },
      { "server": "mcp-pr-companion", "name": "get_pr_sync_status", "exposeAs": "pr__get_pr_sync_status" },
      { "server": "mcp-pr-companion", "name": "list_synced_prs", "exposeAs": "pr__list_synced_prs" },
      { "server": "mcp-pr-companion", "name": "get_pr_comments", "exposeAs": "pr__get_pr_comments" },
      { "server": "mcp-pr-companion", "name": "list_my_open_prs", "exposeAs": "pr__list_my_open_prs" },
      { "server": "mcp-pr-companion", "name": "sync_my_open_prs", "exposeAs": "pr__sync_my_open_prs" },
      { "server": "mcp-pr-companion", "name": "check_bitbucket_connection", "exposeAs": "pr__check_bitbucket_connection" }
    ]
  }
}
```

Both entries start `enabled: false`. Enable them after the child's local `check` passes and `check_bitbucket_connection` succeeds, then restart the client that runs the hub. The CLI check validates Node.js, dependencies, build output, and required configuration; the MCP tool checks live credentials and the account allowlist. Follow the Hub's `AGENTS.md` and `docs/adding-a-child-mcp.md` for local configuration.

## 4. What the hub relies on (do not break)

| Hub behaviour | What this repo guarantees |
|---|---|
| Discards the child's stderr | `Logger` and `bin/cli.js` also write `Logs/mcp-server.log` |
| Treats `isError` or text starting with `Error:` as failure | Every tool goes through `run()` in `src/mcp/tools.ts` |
| Forwards tool schemas and annotations unchanged | zod `inputSchema` and annotations on every tool |
| Prefixes tools with `pr__` | Child tool names have no prefix |
| Prefixes each tool description with `[pr via mcp-pr-companion]`, serves its contract `../mcp-hub/docs/mcps/mcp-pr-companion.md` as a prompt, and does **not** forward this server's `INSTRUCTIONS` | Agents under the hub learn the workflow from the hub contract; `INSTRUCTIONS` reaches only direct connections. Keep tool descriptions self-contained and the contract in step with `INSTRUCTIONS`. |
| Applies a per-call timeout | `get_pr_context_pack` may download a full diff when missing, stale, or awaiting migration and fetch statuses/comments live; `sync_my_open_prs` can process many PRs. Other tools make at most one access-check request per repository per minute. A large open-PR batch can approach `timeoutSeconds`; call it per repository or raise the timeout if observed calls need it. |
| Launches the child once per client session | `AUTO_SYNC_ON_START=true` (child `.env`, or `env` in the hub child config) syncs in the background at each launch |
| Needs a read-only upstream health check for `scripts/smoke.py` (`docs/child-mcp-compatibility.md`) | `check_bitbucket_connection` returns `{"connected": true, "config_source": {"credentials", "workspace", "repository", "allowed_emails"}}` only when the token authenticates; each source is `env`, `hub`, `local` or `unset` |
| Passes `CENTRAL_CONFIG_PATH` to its JSON file | The launcher fills unset Bitbucket values from its `bitbucket` block (§2), falls back to `.env` with a warning when the file is missing or broken, and never writes it |

Renaming a tool, changing its parameters or moving the log path requires updating the hub's `hub.json` allowlist (the user does this), `docs/mcps/mcp-pr-companion.md` and `scripts/smoke.py` in the same change.

## 5. Sync from the hub

The terminal command `node bin/cli.js sync <open|draft|merged|declined|all>` syncs the selected PR groups for the configured account across `BITBUCKET_REPOSITORY`. `open` contains only non-draft open PRs; `draft` contains open draft PRs; the other two match Bitbucket states; `all` combines the four groups. The command follows every page and reports incomplete results if pagination stops. The MCP tool `pr__sync_my_open_prs` and the legacy `generate-all` command keep their open-only behavior. Agents can call `pr__list_synced_prs` with a status filter to find locally cached PRs and then read them by `pr_url`.

## 6. Troubleshooting

| Symptom (hub `logs/mcp-hub.jsonl` / child `Logs/mcp-server.log`) | Fix |
|---|---|
| `server.connect.failed` and `[LAUNCHER] … Fill in BITBUCKET_… in .env or the Hub's bitbucket block` | Fill the hub's `bitbucket` block or `.env` in this repo |
| `[LAUNCHER] … Warning: cannot read the Hub config (CENTRAL_CONFIG_PATH)` or `… has no "bitbucket" block` | Fix the hub file (path, JSON) or its `bitbucket` block; until then `.env` is used |
| `[LAUNCHER] … npm ci failed` / `Build failed` | Run `node bin/cli.js prepare` in this repo and read the output |
| Tool result `Error: PR is not synced yet…` | Call `pr__get_pr_context_pack` first |
| `Error: Access denied. BITBUCKET_EMAIL is not listed in ALLOWED_EMAILS` | Fix `ALLOWED_EMAILS` or the email in the hub's `bitbucket` block or `.env` |
| `Error: No access: Bitbucket rejected the credentials (HTTP 401)…` | Email or token wrong or expired: fix the hub's `bitbucket` block or `.env` (`config_source.credentials` says which) |
| `Error: Failed to fetch PR metadata: HTTP 403` | Token missing `read:pullrequest` |
| `Error: No access: this account cannot read <ws>/<repo>` | The configured account lacks read access to that repository (the encrypted cache stays sealed) |
| `Error: No access: cannot connect to Bitbucket` | Network down: the encrypted cache cannot be unlocked offline, by design |
| Context pack starts with `Note: could not check Bitbucket…` | Network problem; cached data is shown. Retry, or pass `refresh: true` once the network is back. |

## 7. Direct use without the hub

```json
{ "mcpServers": { "mcp-pr-companion": { "command": "node", "args": ["<path>/mcp-pr-companion/bin/cli.js", "server"] } } }
```
