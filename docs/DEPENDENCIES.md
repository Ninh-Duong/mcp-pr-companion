# Dependencies

Every package here costs install time on each fresh clone (mcp-hub runs `npm ci` through `bin/cli.js`) and adds supply-chain risk. Add one only with a row below that says why the stdlib or an existing package cannot do the job.

## Runtime (4)

| Package | Used by | Why it is needed |
|---|---|---|
| `@modelcontextprotocol/sdk` | `src/mcp/` | The MCP protocol: stdio transport, `McpServer`, and `InMemoryTransport` for tests. |
| `zod` | tool schemas, `config.schema.ts`, `output/schema/*` | Required by the SDK's `registerTool` and used for env parsing and the on-disk contract. One validator everywhere. Keep it on v3 (`^3.25`) unless the SDK and every schema move together. |
| `@inquirer/prompts` | `src/cmd/` only | Arrow-key menus in the CLI. `node:readline` would mean rewriting select/confirm widgets by hand. Never import it outside `src/cmd/`. |
| `p-limit` | `generation.manager.ts` | Caps concurrent PR generation in the CLI. ponytail: about 10 lines of stdlib could replace it; do that if it ever causes trouble. |

## Development (3)

| Package | Why |
|---|---|
| `typescript` | Build (`tsc`) and type checking. There is no bundler. |
| `tsx` | Runs `tests/*.test.ts` and `npm run dev` without a build. |
| `@types/node` | Node typings. |

## Deliberately not used

| Instead of | Use | Reason |
|---|---|---|
| `axios`, `node-fetch`, `got` | global `fetch` + `AbortController` | Built in since Node 18. |
| `dotenv` | `process.loadEnvFile` in `bin/cli.js` | Built in since Node 20.12. |
| `winston`, `pino` | `src/utils/logger.ts` | Two sinks (stderr and a file) and secret redaction take about 40 lines. |
| `jest`, `vitest`, `mocha` | `node:assert/strict` + `tests/run.mjs` | One temp cwd per file is all the isolation needed. |
| `eslint`, `prettier` | `tsc` strict + `noUnusedLocals` | Fewer moving parts. Match the surrounding style. |
| `cli-progress` | plain stderr renderers in `src/cmd/` | Was installed but never imported; removed. |
| An AST parser (`@babel/parser`, `tree-sitter`) | regex heuristics in `src/core/analyzer/` | Multi-language diffs, and good enough for "which files to read first". The README says "regex", not "AST". |
