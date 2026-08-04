# 🚀 mcp-pr-companion (v2.0 Architecture)

`mcp-pr-companion` is a dual-interface system combining a **Terminal UI (`npm run cmd`)** and a **Local Model Context Protocol (MCP) Server** designed to pre-process Git Pull Request diffs into compact, agent-ready JSON payloads.

It unifies local Git branch analysis and Bitbucket Cloud REST API v2 integration into a shared core engine featuring **Async Multi-PR Sync**, **Deterministic Revision Caching**, **Scoped API Token Security**, and **Zero-Write Guardrails**.

---

## 🏗️ Architectural Overview

Both the Terminal UI and MCP Server share a single underlying core subsystem:

```text
┌─────────────────────────────────────────┐     ┌─────────────────────────────────────────┐
│           Terminal UI (TUI)             │     │               MCP Server                │
│             `npm run cmd`               │     │               `npm start`               │
└────────────────────┬────────────────────┘     └────────────────────┬────────────────────┘
                     │                                               │
                     ▼                                               ▼
         ┌───────────────────────┐                       ┌───────────────────────┐
         │ Config & PR Registry  │                       │  PR Context Service   │
         └───────────┬───────────┘                       │ (In-memory LRU Cache) │
                     │                                   └───────────┬───────────┘
                     ▼                                               │
         ┌───────────────────────┐                                   │
         │  Async Sync Manager   │                                   │
         └───────────┬───────────┘                                   │
                     │                                               │
                     ▼                                               │
         ┌───────────────────────────────────────────────────────────┴──────────┐
         │                          Shared Core Engine                          │
         │  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  │
         │  │BitbucketCollector│  │  AST / Analyzer  │  │ Local DataStore  │  │
         │  └──────────────────┘  └──────────────────┘  └──────────────────┘  │
         └──────────────────────────────────┬───────────────────────────────────┘
                                            │
                                            ▼
                             ┌──────────────────────────────┐
                             │    .mcp-pr-companion/        │
                             │  ├── config/                 │
                             │  ├── secrets/credentials.env │
                             │  ├── prs/links.json          │
                             │  ├── data/bitbucket/         │
                             │  ├── state/cache-index.json  │
                             │  └── logs/                   │
                             └──────────────────────────────┘
```

---

## 🔒 Security, Account Policy & Ownership Isolation

1. **Account Identity Hard-Locking**:
   - CLI authentication strictly restricts login to authorized account: `ninh.duong@siliconstack.com.au`.
   - Account identity is resolved directly from Bitbucket Cloud API `/2.0/user` to obtain the account UUID (`currentUserUuid`).

2. **Mandatory Ownership Filtering**:
   - All Bitbucket PR queries explicitly construct `state="OPEN" AND author.uuid="{uuid}"`.
   - Client-side ownership policy (`PROwnershipPolicy`) strictly filters raw API responses to ensure PRs belonging to other authors are never displayed or stored in discovery cache.

3. **Readiness Scope Filter (Open / Ready vs. Draft)**:
   - Users can filter PR views and generation targets by:
     - **Open / Ready PRs**: `state === "OPEN" && isDraft === false`
     - **Draft PRs**: `state === "OPEN" && isDraft === true`
     - **All Open PRs**: `state === "OPEN"` (includes both Ready and Draft)
   - Ownership isolation (`author.uuid === currentUserUuid`) is strictly enforced across ALL readiness filters.

4. **Universal Navigation UX**:
   - Every submenu and selection prompt includes an explicit `⬅️ Back` or `Cancel` action to prevent stuck navigation states or unintended operations.

---

## 🌟 Key Features & Subsystems

1. **Dual-Interface Shared Architecture**:
   - **Terminal UI (`npm run cmd`)**: Prepares, validates, and warms local caches.
   - **MCP Server (`npm start`)**: Serves AI Agents with minimal disk I/O and zero redundant network calls.
2. **Token & Context Optimization**:
   - Reduces AI context token consumption by **70% - 95%** (~2-4KB manifest per PR vs 50KB+ raw diffs).
   - Serves file-level AST highlights and risk tags on demand (`get_pr_file_changes`).
3. **Async Batch Sync Engine**:
   - Concurrent queue (`concurrency: 2`) with stage progress tracking (Queued ➔ Validate ➔ Metadata ➔ Commits ➔ Diffstat ➔ Diff Download ➔ Analysis ➔ Persist).
   - Automatic exponential backoff retries with jitter for HTTP 429 (Rate Limit) and 5xx errors, respecting `Retry-After` headers.
   - Clean `SIGINT` (`Ctrl+C`) cancellation with atomic write guarantees.
4. **Deterministic Revision Caching**:
   - Key format: `bitbucket:{workspace}:{repo}:{pr_id}:{source_hash}:{destination_hash}:v2:{config_hash}`.
   - If source & target commit hashes are unchanged, sync operations skip diff downloads completely (100% Cache Hit).
5. **Security & Scoped API Tokens**:
   - Uses Bitbucket Scoped API Tokens (`BITBUCKET_READ_TOKEN`, `BITBUCKET_WRITE_TOKEN`).
   - Credentials stored safely in `.mcp-pr-companion/secrets/credentials.env` (strictly **GIT IGNORED** and validated via `git check-ignore`).
   - Automated token masking (`ATBB****abcd`) and redaction across log files and MCP payloads using `Redactor`.
6. **Capability Guard & Write Safety**:
   - Write capabilities default to `enabled: false`.
   - `CapabilityGuard` blocks any write operations during background sync.

---

## 🖥️ Terminal UI Guide (`npm run cmd`)

Run the interactive terminal interface:

```bash
npm run cmd
```

---

## ⚡ One-Command Mode (`npm run mcp-pr-companion`)

Run automated sequential discovery and generation for all open PRs owned by the authenticated user in a single command:

```bash
npm run mcp-pr-companion
```

### Execution Flow:
1. **Session Reuse / Authentication**:
   - Automatically checks for an active local session (`.mcp-pr-companion/session.json`, 30-minute security TTL).
   - Confirms session reuse or prompts for email, workspace/repo, and masked API token.
2. **PR Discovery**:
   - Resolves `currentUserUuid` from Bitbucket API `/2.0/user`.
   - Discovers all `state === "OPEN"` pull requests matching `author.uuid === currentUserUuid`.
3. **Readiness Scope & Caching Policy**:
   - Includes both **Ready** and **Draft** PRs (`readiness: 'all'`).
   - Smart cache policy (`forceRefresh = false`): New and updated PRs are generated; unchanged PRs reuse cached data.
4. **Summary & Process Exit Codes**:
   - Renders live progress and outputs a final summary report.
   - Standard Exit Codes:
     - `0`: Success (all PRs generated/cached, or 0 PRs discovered)
     - `2`: Partial failure (one or more PRs failed generation)
     - `1`: Authentication, token, repository, or unexpected error
     - `130`: Interrupted by user (Ctrl+C or prompt cancellation)

---

### Main Menu Overview:

```text
🤖 MCP PR Companion Terminal UI
  1. Configuration Settings
  2. Manage PR Link Registry
  3. Sync PR Data (Warm Local Cache)
  4. Browse Local Cached PR Data
  5. View Sync Logs Summary
  6. Exit
```

1. **Configuration Settings**:
   - Configure Workspace slug, Output Language (`vi`, `en`, `bilingual`), and Sync Concurrency.
   - Masked input prompt for `BITBUCKET_READ_TOKEN` and `BITBUCKET_WRITE_TOKEN`.
   - Run `Test Bitbucket Read Connection` (GET-only request).
2. **Manage PR Link Registry**:
   - Add/List/Remove Bitbucket PR URLs.
   - Validate URLs (HTTPS protocol, host `bitbucket.org`, path structure, path traversal prevention `..`).
   - Remove duplicates with single-click deduplication.
3. **Sync PR Data**:
   - Sync All PRs / Select specific PRs / Force Refresh.
   - Live progress rendering showing percentage, current stage, and status per PR.
   - Interruptible safely via `Ctrl+C`.
4. **Browse Local Cached PR Data**:
   - Inspect offline cached PR manifests, ticket IDs, file count, and last checked timestamps.
5. **View Sync Logs Summary**:
   - Inspect JSON Lines run logs (`.mcp-pr-companion/logs/YYYY-MM-DD/run-{id}.jsonl`) and summary reports.

---

## 📡 MCP Server Tools & AI Integration

Start the MCP server over stdio transport:

```bash
npm start
```

### Registered Tools:

| Tool | Description | Input Parameters | Output |
| --- | --- | --- | --- |
| `get_pr_manifest` | Returns compact agent-ready JSON manifest for a PR from local RAM/disk cache. | `pr_url` (string, required)<br>`refresh` (boolean, optional) | `PRManifest` (~2-4KB) |
| `get_pr_file_changes` | Returns detailed AST highlights, risk tags, and hunk stats for a specific `file_id`. | `pr_url` (string, required)<br>`file_id` (number, required) | `PRFileDetail` |
| `get_pr_sync_status` | Returns local cache sync status, current revision hash, and last checked timestamp. | `pr_url` (string, required) | `{ synced: boolean, current: object }` |
| `refresh_pr_data` | Re-fetches fresh PR data from Bitbucket API (read-only) and updates local cache. | `pr_url` (string, required) | `PRManifest` |
| `generate_pr_payload` | Backward-compatible tool for generating full PR payloads from local Git or Bitbucket. | `pr_url`, `source_branch`, `target_branch`, `repo_path` | Full PR Payload |

### MCP Client Config (`mcpServers`):

```json
{
  "mcpServers": {
    "mcp-pr-companion": {
      "command": "node",
      "args": [
        "d:/VisualStudioCode/mcp-pr-companion/dist/mcp/server.js"
      ]
    }
  }
}
```

---

## 🔑 Bitbucket API Token Setup Guide

1. Log into [Bitbucket Cloud](https://bitbucket.org).
2. Go to **Personal settings** ➔ **App Passwords** or **API Tokens**.
3. Create a token with the following minimum required **Read** scopes:
   - ✅ **Pull requests**: `Read` (`read:pullrequest:bitbucket`)
   - ✅ **Repositories**: `Read` (`read:repository:bitbucket`)
4. Open `npm run cmd` ➔ **Configuration Settings** ➔ **Configure Bitbucket Read Token**.
5. Enter your email and token. They will be saved to `.mcp-pr-companion/secrets/credentials.env`:

```env
# Local MCP PR Companion Credentials
BITBUCKET_EMAIL=user@company.com
BITBUCKET_READ_TOKEN=ATBBxxxxxxxxxxxxxxxx
BITBUCKET_WRITE_TOKEN=
```

---

## 📁 Runtime Directory & Project Layout

```text
mcp-pr-companion/
├── .mcp-pr-companion/              # [GIT IGNORED] Local Runtime Storage
│   ├── config/                     # base.json, read.json, write.json
│   ├── secrets/                    # credentials.env
│   ├── prs/                        # links.json (PR URL registry)
│   ├── data/bitbucket/             # Raw patch files & compressed derived JSONs
│   ├── state/                      # cache-index.json & job state
│   └── logs/                       # JSON Lines run logs & summary reports
│
├── config.templates/               # Safe JSON configuration templates
│   ├── base.example.json
│   ├── read.example.json
│   └── write.example.json
│
├── src/
│   ├── cmd/                        # Terminal UI (runner, menus, progress renderer)
│   │   ├── cmd.runner.ts
│   │   ├── main.menu.ts
│   │   ├── config.menu.ts
│   │   ├── pr-list.menu.ts
│   │   ├── sync.menu.ts
│   │   └── progress.renderer.ts
│   ├── config/                     # Config schema, manager, secret store, capability guard
│   │   ├── config.schema.ts
│   │   ├── config.manager.ts
│   │   ├── secret.store.ts
│   │   └── capability.guard.ts
│   ├── core/                       # Core engine subsystems
│   │   ├── bitbucket/              # Collector, client, auth, pagination
│   │   ├── registry/               # PR registry & URL parser
│   │   ├── storage/                # DataStore, atomic writer, cache index, retention
│   │   ├── sync/                   # SyncManager, SyncJob, retry policy, stage events
│   │   ├── analyzer/               # Module classifier & AST extractor
│   │   ├── generator/              # Payload builder
│   │   └── git/                    # Git executor (execFileSync) & parser
│   ├── mcp/                        # MCP server & PR context service
│   │   ├── server.ts
│   │   └── context.service.ts
│   └── utils/                      # Logger & Redactor
│
├── tests/                          # Automated unit & integration tests
│   └── unit.test.ts
├── package.json
└── tsconfig.json
```

---

## 🛠️ Package Scripts & Verification

- **Launch Interactive Terminal UI**:
  ```bash
  npm run cmd
  ```
- **Start MCP Production Server**:
  ```bash
  npm start
  ```
- **Start MCP Dev Server (Hot Reload)**:
  ```bash
  npm run dev
  ```
- **Run Unit & Integration Test Suite**:
  ```bash
  npx tsx tests/unit.test.ts
  ```
- **Check TypeScript Types**:
  ```bash
  npx tsc --noEmit
  ```
- **Build Production Assets**:
  ```bash
  npm run build
  ```
