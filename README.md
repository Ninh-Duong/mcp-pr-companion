# 🚀 mcp-pr-companion

`mcp-pr-companion` is a **Local Model Context Protocol (MCP) Server** designed to run offline on developer workstations or connect directly to Bitbucket Cloud REST API.

It automatically parses Git diffs, commit histories, and code structures, categorizing changes into architectural layers (Database, API Controllers, Services, gRPC, Unit Tests) via AST/Regex extraction rules. It then packages the extracted data into a **compact JSON payload (~1-2KB)** tailored for AI PR description generation.

---

## 🎯 Purpose & Key Benefits

- **Token Optimization**: Reduces AI context token consumption by **80% - 90%** by eliminating raw diff dumps.
- **Speed**: Accelerates PR description generation by **5x - 10x**.
- **Privacy & Security**: Operates 100% locally or via secure read-only Bitbucket API. Raw git diffs remain on your machine; only sanitized JSON summary metadata is passed to the AI.
- **Auto-Archiving Each Execution**: Every execution automatically saves a timestamped JSON snapshot to `./output/description_kb_{PR_ID}_{TIMESTAMP}.json` for historical tracking and easy AI retrieval.
- **Real-Time Step Logging**: Emits clean step-by-step progress logs to `stderr` during API connections and diff analysis.

---

## 💾 Automatic JSON File Archiving (`./output/`)

Every time `generate_pr_payload` runs, a unique JSON file is automatically written to the `./output/` directory:

- **Filename Pattern**: `description_kb_{ticketId_or_prId}_{timestamp}.json`
- **Example File**: `./output/description_kb_WCE-815_pr_123_20260728_181235.json`

> [!NOTE]
> The `./output/` directory is **GIT IGNORED** via `.gitignore` to prevent any temporary data files from being committed to your source code repository.

---

## 🔐 Bitbucket API Credentials & Token Setup Guide

To fetch Pull Request data directly via Bitbucket PR URLs (`https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`), create a Bitbucket **App Password** with **Read-Only** permissions.

### 🔑 How to Generate a Bitbucket App Password (Token):

1. Log into [Bitbucket Cloud](https://bitbucket.org).
2. Click your Avatar profile icon (Settings) -> Select **Personal settings**.
3. In the left navigation menu under **Access Management**, click **App Passwords**.
4. Click the **Create app password** button.
5. Set a Label (e.g., `mcp-pr-companion`).
6. **Check ONLY the following 2 Read permissions** for maximum security:
   - ✅ **Pull requests**: `Read` (`pullrequest:read`)
   - ✅ **Repositories**: `Read` (`repository:read`)
7. Click **Create** and copy the generated App Password token.

---

### ⚙️ Configuring `config.json`:
Paste your Bitbucket username and the generated App Password token into `config.json` (which is `.gitignore` protected):

```json
{
  "ticket_prefix": ["WCE-", "PROJ-", "JIRA-"],
  "output_language": "vi",
  "default_target_branch": "main",
  "bitbucket": {
    "workspace": "your-company-workspace",
    "username": "your_email@company.com",
    "app_password": "ATBBxxxxxxxxxxxxxxxxxxxxxxxx"
  }
}
```

---

## 📡 Real-Time Console Progress Logs

During execution, `mcp-pr-companion` outputs detailed step-by-step progress logs to `stderr` so you can monitor execution status:

```text
[STEP 1/5] 🌐 Parsing Bitbucket PR URL: https://bitbucket.org/workspace/repo/pull-requests/123
[STEP 2/5] 📋 Fetching PR Metadata for workspace/repo PR #123...
  ✓ Found PR: "[WCE-815] Tiered Call Outcomes" (feature/WCE-815 -> main) by Ninh Duong
[STEP 3/5] 📜 Fetching PR Commit History...
  ✓ Retrieved 3 commits
[STEP 4/5] 📊 Fetching PR Diffstat and Raw Code Diff...
  ✓ Found 12 changed files (+450 / -60 lines)
[STEP 5/5] 🧩 Classifying changed files into Modules & extracting Code Highlights...
✅ [SUCCESS] Payload generated and saved to: ./output/description_kb_WCE-815_pr_123_20260728_181235.json
```

---

## 📁 Repository Structure & Security Guidelines

```
mcp-pr-companion/
├── bin/
│   └── cli.js                      # CLI execution entrypoint
├── scripts/
│   └── setup.js                    # 1-Click Auto-Setup & Healthcheck bootstrapper
├── src/
│   ├── healthcheck/                # Environment pre-flight check (Node, Git CLI)
│   │   └── healthcheck.ts
│   ├── config/                     # Configuration schema & loader
│   │   ├── config.loader.ts
│   │   └── config.schema.ts
│   ├── core/                       # Core Git & Bitbucket extraction logic
│   │   ├── bitbucket/              # Bitbucket REST API v2 connector
│   │   │   └── bitbucket.service.ts
│   │   ├── git/                    # Local Git CLI runner & parsers
│   │   ├── analyzer/               # Module classifier & code highlight extractor
│   │   └── generator/              # Payload JSON builder (~1-2KB output & file saver)
│   ├── mcp/                        # MCP Protocol implementation (Stdio Transport)
│   │   ├── server.ts
│   │   └── tools/                  # Registered tool: generate_pr_payload
│   └── utils/
│       └── logger.ts               # Safe stderr logging (prevents stdio corruption)
│
├── ⚠️ config.json                  # [SENSITIVE] Local configuration (GIT IGNORED)
├── config.example.json             # Safe default configuration template
├── 🔒 output/                      # [GIT IGNORED] Auto-saved PR JSON payload archives
├── .gitignore                      # Security rules ignoring tokens, keys & configs
├── package.json
├── tsconfig.json
└── README.md
```

---

## ⚙️ Available Commands & Scripts

- **1-Click Setup & Installation Bootstrapper**:
  ```bash
  npm run setup
  ```
- **Start Production MCP Server**:
  ```bash
  npm start
  ```
- **Start Development Mode (Hot Reload / Live TS)**:
  ```bash
  npm run dev
  ```
- **Run Pre-flight Healthcheck**:
  ```bash
  npm run healthcheck
  ```
- **Build TypeScript Project**:
  ```bash
  npm run build
  ```

---

## 🛠️ MCP Client Integration Setup

Add the relative path execution command to your MCP configuration file:

```json
{
  "mcpServers": {
    "mcp-pr-companion": {
      "command": "node",
      "args": [
        "./dist/mcp/server.js"
      ],
      "env": {}
    }
  }
}
```

---

## 🚀 Usage Example

Provide a Bitbucket PR link to your AI assistant:

> *"Here is my PR link: `https://bitbucket.org/workspace/repo/pull-requests/123`. Please use `generate_pr_payload` to fetch data and write a PR description for Bitbucket."*

The AI assistant will invoke `generate_pr_payload` locally, stream step-by-step progress to your console log, save a snapshot file to `./output/description_kb_WCE-815_pr_123_20260728_181235.json`, receive a lightweight ~1KB JSON summary, and render a formatted PR description.
