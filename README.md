# mcp-pr-companion

A read-only Bitbucket Cloud pull request tool that turns PRs into compact context packs for AI agents such as Claude, Copilot, and Cursor.

You can use it in three ways:

| Use | Command | Purpose |
|---|---|---|
| Interactive terminal menu | .\run.cmd cmd | Browse your PRs, sync one PR, generate several PRs, or view decrypted context |
| Batch generation | .\run.cmd generate-all | Generate context for all of your open PRs across the configured repositories |
| MCP server | .\run.cmd | Let an AI client retrieve PR context directly or through [mcp-hub](docs/HUB_INTEGRATION.md) |

## 1. Quick start

### Step 1: Clone the repository

~~~bash
git clone <repo-url>
cd mcp-pr-companion
~~~

### Step 2: Start the tool

| Platform | Command |
|---|---|
| Windows PowerShell | .\run.cmd cmd |
| Windows Command Prompt | run.cmd cmd |
| macOS / Linux | ./run.sh cmd |

On first launch, the tool prepares the environment:

1. Installs Node.js if it is missing or older than 20.12.
2. Runs npm ci if dependencies are missing.
3. Builds the project if needed.
4. Creates a .env file if one does not exist, then stops so you can fill it in.

The check command only checks dependencies, build output, and configuration. It does not install dependencies, build, or create .env. The run.cmd and run.sh wrappers may still install Node.js before invoking check. To install dependencies and build without starting the app, run .\run.cmd prepare or ./run.sh prepare.

### Step 3: Configure .env

Fill in the repository root .env file:

~~~ini
BITBUCKET_EMAIL=user@example.com
BITBUCKET_API_TOKEN=ATATT...
BITBUCKET_WORKSPACE=acme
BITBUCKET_REPOSITORY=api,web
~~~

BITBUCKET_REPOSITORY accepts comma-separated repositories. Entries without a workspace use BITBUCKET_WORKSPACE. Use workspace/repo for a repository in another workspace, such as api,other-team/tool.

Run .\run.cmd check. A successful check looks like this:

~~~text
✓ Node.js: Node.js 22.20.0 (requires >=20.12)
✓ Dependencies: dependencies match package-lock.json
✓ Build: dist/ is up to date
✓ Config (.env): required settings present
~~~

Create an API token in Bitbucket under Personal settings → API tokens → Create API token with scopes. Grant only the read scopes read:user:bitbucket, read:pullrequest:bitbucket, and read:repository:bitbucket. Do not grant write, admin, or delete scopes.

## 2. Daily use

~~~powershell
.\run.cmd cmd
.\run.cmd generate-all
.\run.cmd sync open
.\run.cmd sync draft
.\run.cmd sync merged
.\run.cmd sync declined
.\run.cmd sync all
.\run.cmd check
.\run.cmd purge-plaintext
~~~

The sync command accepts exactly one mode: open, draft, merged, declined, or all. It syncs PRs authored by the configured account across every repository in BITBUCKET_REPOSITORY. The groups do not overlap: open excludes drafts; draft includes open draft PRs; merged and declined use their matching Bitbucket states; all includes all four groups. If Bitbucket stops pagination early, the command reports incomplete results and exits with an error code. A failed PR is reported while the remaining PRs continue.

The older generate-all command keeps its existing behavior and generates context for your open PRs. The sync_my_open_prs MCP tool also keeps its existing meaning.

With Node.js 20.12 or newer, these npm commands are equivalent:

| npm command | Equivalent |
|---|---|
| npm run cmd | .\run.cmd cmd |
| npm run mcp-pr-companion | .\run.cmd generate-all |
| npm start | .\run.cmd (MCP server) |
| npm run healthcheck | .\run.cmd check |

In PowerShell, prefix the command with .\ (for example, .\run.cmd). Typing run.cmd by itself will not find the command.

### Where data is stored

The canonical directory for each synced PR is:

~~~text
ai-context/[<AI_CONTEXT_COMPANY>/]<workspace>/<repo>/<open|draft|merged|declined>/pr_<id>/
├── current.json
├── context.md
├── files.md
├── actions.md
├── manifest.json
├── files/file_NNNN.md
└── revisions/rev_<src7>_<dst7>/
~~~

The status directory reflects the last successful sync. Old data is moved after the new encrypted revision is valid. Readers also find legacy directories during migration. The file names and schema v4 layout inside each PR remain unchanged. Files under ai-context are encrypted; AI agents must read them through MCP tools.

CLI logs are written under Logs/<date>/. MCP server logs are written to Logs/mcp-server.log.

## 3. Use with an AI client

Add the server to the MCP configuration for Claude Code, Cursor, VS Code, or another MCP client. Replace the placeholder path:

~~~json
{
  "mcpServers": {
    "mcp-pr-companion": {
      "command": "node",
      "args": ["<path-to>/mcp-pr-companion/bin/cli.js", "server"]
    }
  }
}
~~~

Give the AI a Bitbucket PR URL, for example: Summarize https://bitbucket.org/<workspace>/<repo>/pull-requests/123.

The MCP tools (prefixed with pr__ when exposed through mcp-hub) are:

| Tool | Purpose |
|---|---|
| get_pr_context_pack | Get the PR context pack. Start here; it syncs when missing or when commits, state, or draft status changed. Set refresh=true to force a sync. |
| search_pr_files | Find files by path, language, status, change kind, or risk tag. |
| get_pr_file_context | Read one file summary and a paged sanitized diff. |
| get_pr_file_changes | Get a file's classification, risk, symbols, and an optional diff page as JSON. |
| get_pr_sync_status | Check whether a PR is cached and view its PR status, revision, sync time, and commit hashes. |
| list_synced_prs | List locally synced PRs, optionally filtered by repository and open, draft, merged, or declined status. Results are paged. |
| get_pr_comments | Read sanitized review comments, including inline comments with file_id when available. |
| list_my_open_prs | List your open PRs and their pr_url for a configured repository or all configured repositories. |
| sync_my_open_prs | Sync your open PRs for one or all configured repositories. This existing tool retains its open-only behavior. |
| check_bitbucket_connection | Check that the configured Bitbucket credentials can access Bitbucket. |

To discover cached PRs, call list_synced_prs and filter by status. Then use the returned pr_url with get_pr_context_pack or the file tools. Do not read ai-context files directly because they are encrypted.

Run the CLI sync command locally to fetch historical groups, then use list_synced_prs through MCP to browse and read the encrypted cache. The Hub's pr__sync_my_open_prs tool keeps its existing open-only behavior. AUTO_SYNC_ON_START=true syncs open PRs in the background whenever the MCP server starts.

### Run under mcp-hub

1. Clone this repository beside mcp-hub: <parent>/mcp-hub and <parent>/mcp-pr-companion. The Hub template runs node bin/cli.js server from the child repository.
2. Run node bin/cli.js prepare once to install dependencies and build.
3. Keep credentials in this repository's .env. The Hub does not pass secrets.
4. The Hub exposes child tools with the pr__ prefix.

See [docs/HUB_INTEGRATION.md](docs/HUB_INTEGRATION.md) and the Hub contract at ../mcp-hub/docs/mcps/mcp-pr-companion.md.

## 4. Configuration

All configuration is stored in .env. See [.env.example](.env.example) for the full list.

| Variable | Required | Purpose |
|---|---|---|
| BITBUCKET_EMAIL | Yes | Atlassian account email |
| BITBUCKET_API_TOKEN | Yes | Read-only Bitbucket API token |
| BITBUCKET_REPOSITORY | For cmd, generate-all, sync, and check | Comma-separated repository list. generate-all and sync process all configured repositories. cmd lets you choose repositories. The MCP server can start without it when tools receive an explicit repository or PR URL. |
| BITBUCKET_WORKSPACE | No | Default workspace for repository entries without workspace/repo. |
| ALLOWED_EMAILS | No | Comma-separated account allowlist; empty allows any account with valid repository access. |
| AUTO_SYNC_ON_START | No | true syncs the account's open PRs in configured repositories in the background. Default: false. |
| TICKET_PREFIXES | No | Preferred ticket prefixes. Default: WCE-,PROJ-,JIRA-. The tool also detects KEY-123 in branch names or [KEY-123] in titles. |
| PRIVACY_* | No | Privacy controls for returned and stored PR content. Defaults are safe. |
| AI_CONTEXT_ROOT | No | Context storage directory. Default: ai-context. |
| AI_CONTEXT_COMPANY | No | Optional directory inserted before <workspace>. |
| DEBUG | No | true enables additional MCP log messages. Default: false. |

### Security

- .env is ignored by Git and excluded from the Docker image.
- The API token stays in .env and process memory. The tool never writes or prints it.
- Only the empty template .env.example is committed.
- Secrets in diffs and emails in titles, descriptions, and commit messages are redacted before storage and output.

### Encrypted ai-context data

- Every file under ai-context is encrypted with AES-256-GCM. File names reveal the workspace, repository, PR number, and file ids, but file content is not readable in a file browser.
- Read content through MCP tools or the CLI menu after a successful Bitbucket access check using .env credentials and ALLOWED_EMAILS. Offline access is not available.
- The encryption key is derived from the repository UUID returned by Bitbucket and held only in memory.
- Data created before encryption can be removed with .\run.cmd purge-plaintext; sync the PRs again afterward.
- See [docs/ENCRYPTION.md](docs/ENCRYPTION.md) for details and limitations.

## 5. Docker (optional)

~~~bash
docker build -t mcp-pr-companion .

# Generate context for all open PRs
docker run --rm --env-file .env -v "$PWD/ai-context:/app/ai-context" mcp-pr-companion generate-all

# Sync selected PR states
docker run --rm --env-file .env -v "$PWD/ai-context:/app/ai-context" mcp-pr-companion sync all

# Interactive menu
docker run --rm -it --env-file .env -v "$PWD/ai-context:/app/ai-context" mcp-pr-companion cmd

# MCP server
docker run --rm -i --env-file .env -v "$PWD/ai-context:/app/ai-context" mcp-pr-companion
~~~

## 6. Troubleshooting

Run .\run.cmd check first.

| Message | Resolution |
|---|---|
| Fill in BITBUCKET_... in .env | Fill in the missing setting in .env. |
| Email or API token invalid | Check the account email and token or create a new token. |
| Repository read access failed | Check BITBUCKET_REPOSITORY and the read:repository scope. |
| No access: this account cannot read <ws>/<repo> | The configured account cannot read the repository, so it cannot unlock the encrypted cache. |
| No access: cannot connect to Bitbucket | Restore network access; encrypted data cannot be unlocked offline. |
| Unencrypted ai-context file | Run purge-plaintext or sync the PR again. |
| npm ci failed | Check network or proxy access to the npm registry. |
| Node.js requires >=20.12 | Use run.cmd or run.sh to install Node.js, or install it from https://nodejs.org. |
| run.cmd is not recognized | In PowerShell, use .\run.cmd. |
| Linux requests sudo | Installing Node.js requires administrator permissions. |

## 7. How it works

~~~mermaid
flowchart LR
    A[PR URL / CLI] --> B[Read-only Bitbucket API]
    B --> C[Analyze changes and risks]
    C --> D[Redact sensitive information]
    D --> E[Encrypt and write context pack]
    E --> F[AI reads through MCP]
~~~

Small PRs receive concise summaries. Large or high-risk PRs identify the files that need closer review. Writes are staged and validated so an interrupted sync does not replace the previous active revision.

## 8. Development

~~~bash
npm run dev
npm run build
npm test
~~~

- run.cmd and run.sh check and install Node.js when required.
- bin/cli.js checks dependencies, builds when needed, loads .env, and starts the requested command.
- The build refreshes when src/, tsconfig.json, package-lock.json, or package.json changes.
- CI tests Windows, macOS, and Ubuntu with Node.js 20.12.0 and 22; Ubuntu also builds the Docker image.
- Source code is in src/ and tests are in tests/.

Developer and agent documentation:

| File | Contents |
|---|---|
| [AGENTS.md](AGENTS.md) | Required agent rules, invariants, code map, MCP tool reference, and definition of done |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Pipeline, storage layout, atomic writes, and freshness checks |
| [docs/STANDARDS.md](docs/STANDARDS.md) | Coding conventions, MCP contract, and privacy contract |
| [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) | Dependency rationale and packages deliberately avoided |
| [docs/HUB_INTEGRATION.md](docs/HUB_INTEGRATION.md) | Running as an mcp-hub child |
| [docs/ENCRYPTION.md](docs/ENCRYPTION.md) | ai-context encryption, key source, access gate, limitations, and migration |
