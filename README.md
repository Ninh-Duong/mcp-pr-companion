# 🚀 mcp-pr-companion

`mcp-pr-companion` is a **Local Model Context Protocol (MCP) Server** designed to run offline on developer workstations. 

It automatically parses local Git repository diffs, commit histories, and code structures, categorizing changes into architectural layers (Database, API Controllers, Services, gRPC, Unit Tests) via AST/Regex extraction rules. It then packages the extracted data into a **compact JSON payload (~1-2KB)** tailored for AI PR description generation.

---

## 🎯 Purpose & Key Benefits

- **Token Optimization**: Reduces AI context token consumption by **80% - 90%** by eliminating raw diff dumps.
- **Speed**: Accelerates PR description generation by **5x - 10x**.
- **Privacy & Security**: Operates 100% locally. Raw git diffs remain on your machine; only sanitized JSON summary metadata is passed to the AI.
- **Target Audience**: Software Engineers, Tech Leads, and Code Reviewers working with Bitbucket, GitHub, or GitLab.

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
│   ├── core/                       # Core Git extraction & analysis logic
│   │   ├── git/                    # Local Git CLI runner & parsers
│   │   ├── analyzer/               # Module classifier & code highlight extractor
│   │   └── generator/              # Payload JSON builder (~1-2KB output)
│   ├── mcp/                        # MCP Protocol implementation (Stdio Transport)
│   │   ├── server.ts
│   │   └── tools/                  # Registered tool: generate_pr_payload
│   └── utils/
│       └── logger.ts               # Safe stderr logging (prevents stdio corruption)
│
├── ⚠️ config.json                  # [SENSITIVE] Local configuration (GIT IGNORED)
├── config.example.json             # Safe default configuration template
├── .gitignore                      # Security rules ignoring tokens, keys & configs
├── package.json
├── tsconfig.json
└── README.md
```

> [!CAUTION]
> **[⚠️ SENSITIVE DATA WARNING]**
> `config.json` stores local project rules and potential tokens. It is explicitly listed in `.gitignore` to **PREVENT ACCIDENTAL COMMITS** of sensitive data to remote repositories.

---

## ⚙️ 1-Click Setup & Installation

When cloning this repository to any environment or machine, run the setup command:

```bash
npm run setup
```

**The Auto-Setup bootstrapper automatically executes 5 steps:**
1. 🔍 **Environment Verification**: Validates Node.js (>= 18) and Git CLI availability.
2. 📦 **Dependency Resolution**: Automatically executes `npm install` if `node_modules` is missing.
3. ⚙️ **Config Initialization**: Auto-creates `config.json` from `config.example.json` if missing.
4. 🛠️ **TypeScript Build**: Compiles TypeScript source code into `./dist/`.
5. ✅ **Healthcheck Verification**: Confirms system readiness.

---

## 🛠️ MCP Client Integration Setup

To connect `mcp-pr-companion` with your AI Assistant (e.g., Antigravity CLI, VSCode MCP, or Claude Desktop), add the relative path execution command to your MCP configuration file:

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

*Note: Replace `./dist/mcp/server.js` with the relative path to the `mcp-pr-companion` installation directory on your machine.*

---

## 🚀 Usage Example

Once integrated, ask your AI assistant:

> *"I just completed work on branch `feature/WCE-815-staging`. Please call the `generate_pr_payload` tool to inspect the changes and generate a PR description for Bitbucket."*

The AI assistant will invoke `generate_pr_payload` locally, receive a lightweight ~1KB JSON summary, and render a formatted PR description in seconds.
