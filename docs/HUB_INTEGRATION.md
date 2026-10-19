# Running under mcp-hub

[mcp-hub](../../mcp-hub) launches this repository as a local stdio child and exposes an allowlisted set of its tools to AI clients. The hub-side contract is `../mcp-hub/docs/mcps/mcp-pr-companion.md`. The shared rules every child must follow are in `../mcp-hub/docs/child-mcp-compatibility.md`, and the onboarding runbook is `../mcp-hub/docs/adding-a-child-mcp.md`.

## 1. Requirements

- The repo sits next to the hub: `<parent>/mcp-hub` and `<parent>/mcp-pr-companion`.
- `.env` in this repo has at least `BITBUCKET_EMAIL` and `BITBUCKET_API_TOKEN`. The hub passes no secrets; the child reads its own `.env`, just as `mcp-server-logs` does.
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
- To override a setting for the hub only (for example `PRIVACY_FILE_PATH_MODE`), put it in `env`. Real env vars win over `.env`. Never put the token there.

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
      { "server": "mcp-pr-companion", "name": "check_bitbucket_connection", "exposeAs": "pr__check_bitbucket_connection" }
    ]
  }
}
```

Both entries start `enabled: false`. Set both to `true` once `.env` is filled and `check` passes, then restart the client that runs the hub. Agents edit hub config only through `uv run python scripts/private_config.py` and never open `config/private/**` (hub `AGENTS.md`).

## 4. What the hub relies on (do not break)

| Hub behaviour | What this repo guarantees |
|---|---|
| Discards the child's stderr | `Logger` and `bin/cli.js` also write `Logs/mcp-server.log` |
| Treats `isError` or text starting with `Error:` as failure | Every tool goes through `run()` in `src/mcp/tools.ts` |
| Forwards tool schemas and annotations unchanged | zod `inputSchema` and annotations on every tool |
| Prefixes tools with `pr__` | Child tool names have no prefix |
| Serves the contract file as a prompt and passes on server instructions | `INSTRUCTIONS` stays short and generic |
| Applies a per-call timeout | Only `get_pr_context_pack` and `check_bitbucket_connection` do network I/O; file tools are local reads |
| Needs a read-only upstream health check for `scripts/smoke.py` (`docs/child-mcp-compatibility.md`) | `check_bitbucket_connection` returns `{"connected": true}` only when the token authenticates |

Renaming a tool, changing its parameters or moving the log path requires updating the hub's `hub.json` allowlist (the user does this), `docs/mcps/mcp-pr-companion.md` and `scripts/smoke.py` in the same change.

## 5. Troubleshooting

| Symptom (hub `logs/mcp-hub.jsonl` / child `Logs/mcp-server.log`) | Fix |
|---|---|
| `server.connect.failed` and `[LAUNCHER] … Fill in BITBUCKET_… in .env` | Fill `.env` in this repo |
| `[LAUNCHER] … npm ci failed` / `Build failed` | Run `node bin/cli.js prepare` in this repo and read the output |
| Tool result `Error: PR is not synced yet…` | Call `pr__get_pr_context_pack` first |
| `Error: Access denied. BITBUCKET_EMAIL is not listed in ALLOWED_EMAILS` | Fix `ALLOWED_EMAILS` or the email in `.env` |
| `Error: Failed to fetch PR metadata: HTTP 401` / `403` | Token expired or missing `read:pullrequest` / `read:repository` |
| Context pack starts with `Note: could not check Bitbucket…` | Network problem; cached data is shown. Retry, or pass `refresh: true` once the network is back. |

## 6. Direct use without the hub

```json
{ "mcpServers": { "mcp-pr-companion": { "command": "node", "args": ["<path>/mcp-pr-companion/bin/cli.js", "server"] } } }
```
