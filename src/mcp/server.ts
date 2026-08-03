import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { handleGeneratePRPayload } from './tools/pr_payload.tool.js';
import { PRContextService } from './context.service.js';
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
      version: '2.0.0'
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
          description: 'Extracts Bitbucket PR or local Git branch diffs, commits, and AST module categorizations into a compact JSON schema for AI PR description generation.',
          inputSchema: {
            type: 'object',
            properties: {
              pr_url: { type: 'string', description: 'Full Bitbucket PR URL.' },
              source_branch: { type: 'string', description: 'Source branch name.' },
              target_branch: { type: 'string', description: 'Target branch name.' },
              repo_path: { type: 'string', description: 'Absolute path to target Git repo directory.' }
            }
          }
        },
        {
          name: 'get_pr_manifest',
          description: 'Retrieves compact agent-ready manifest for a synced Bitbucket PR (minimal token footprint ~2-4KB). Serves from local cache/disk.',
          inputSchema: {
            type: 'object',
            properties: {
              pr_url: { type: 'string', description: 'Full Bitbucket PR URL.' },
              refresh: { type: 'boolean', description: 'Force re-fetching from Bitbucket API. Defaults to false.' }
            },
            required: ['pr_url']
          }
        },
        {
          name: 'get_pr_file_changes',
          description: 'Retrieves specific file change details (AST highlights, risk tags) by file_id for a synced Bitbucket PR.',
          inputSchema: {
            type: 'object',
            properties: {
              pr_url: { type: 'string', description: 'Full Bitbucket PR URL.' },
              file_id: { type: 'number', description: 'Numeric file ID from get_pr_manifest list.' }
            },
            required: ['pr_url', 'file_id']
          }
        },
        {
          name: 'get_pr_sync_status',
          description: 'Checks local sync status and cached revision info for a Bitbucket PR.',
          inputSchema: {
            type: 'object',
            properties: {
              pr_url: { type: 'string', description: 'Full Bitbucket PR URL.' }
            },
            required: ['pr_url']
          }
        },
        {
          name: 'refresh_pr_data',
          description: 'Refreshes local PR data cache by calling Bitbucket API (read-only action).',
          inputSchema: {
            type: 'object',
            properties: {
              pr_url: { type: 'string', description: 'Full Bitbucket PR URL.' }
            },
            required: ['pr_url']
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

      if (name === 'get_pr_manifest') {
        const { pr_url, refresh } = (args || {}) as any;
        const manifest = await PRContextService.getManifest(pr_url, Boolean(refresh));
        return { content: [{ type: 'text', text: JSON.stringify(manifest) }] };
      }

      if (name === 'get_pr_file_changes') {
        const { pr_url, file_id } = (args || {}) as any;
        const detail = await PRContextService.getFileDetail(pr_url, Number(file_id));
        return { content: [{ type: 'text', text: JSON.stringify(detail || { error: 'File detail not found' }) }] };
      }

      if (name === 'get_pr_sync_status') {
        const { pr_url } = (args || {}) as any;
        const status = PRContextService.getSyncStatus(pr_url);
        return { content: [{ type: 'text', text: JSON.stringify(status) }] };
      }

      if (name === 'refresh_pr_data') {
        const { pr_url } = (args || {}) as any;
        const manifest = await PRContextService.refreshPRData(pr_url);
        return { content: [{ type: 'text', text: JSON.stringify(manifest) }] };
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
