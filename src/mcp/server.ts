import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { handleGeneratePRPayload } from './tools/pr_payload.tool.js';
import { runHealthCheck } from '../healthcheck/healthcheck.js';
import { Logger } from '../utils/logger.js';

async function startServer() {
  Logger.info('Starting mcp-pr-companion Local MCP Server...');

  // Perform quick pre-flight healthcheck
  const health = runHealthCheck();
  if (!health.checks.node || !health.checks.git) {
    Logger.error('Healthcheck failed on startup. Please run "npm run setup" first.', health.messages);
  }

  const server = new Server(
    {
      name: 'mcp-pr-companion',
      version: '1.0.0'
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  // Register Available Tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'generate_pr_payload',
          description: 'Extracts Bitbucket PR or local Git branch diffs, commits, and AST module categorizations into a compact JSON schema (~1-2KB) for AI PR description generation.',
          inputSchema: {
            type: 'object',
            properties: {
              pr_url: {
                type: 'string',
                description: 'Full Bitbucket PR URL (e.g., https://bitbucket.org/workspace/repo/pull-requests/123).'
              },
              source_branch: {
                type: 'string',
                description: 'Source branch name (e.g., feature/WCE-815). Defaults to currently checked out branch.'
              },
              target_branch: {
                type: 'string',
                description: 'Target branch name (e.g., main or release/staging). Defaults to main.'
              },
              repo_path: {
                type: 'string',
                description: 'Absolute path to target Git repo directory.'
              }
            }
          }
        }
      ]
    };
  });

  // Handle Tool Executions
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    Logger.info(`CallTool requested: ${name}`);

    try {
      if (name === 'generate_pr_payload') {
        return await handleGeneratePRPayload(args);
      }
      throw new Error(`Tool not found: ${name}`);
    } catch (err: any) {
      Logger.error(`Error executing tool ${name}:`, err);
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error executing ${name}: ${err.message || String(err)}`
          }
        ]
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  Logger.info('mcp-pr-companion MCP Server is running over stdio transport.');
}

startServer().catch((err) => {
  Logger.error('Fatal error starting mcp-pr-companion MCP Server:', err);
  process.exit(1);
});
