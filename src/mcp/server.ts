import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { handleGeneratePRPayload } from './tools/pr_payload.tool.js';
import { PRContextService } from './context.service.js';
import { runHealthCheck } from '../healthcheck/healthcheck.js';
import { Logger } from '../utils/logger.js';

async function startServer() {
  Logger.info('Starting mcp-pr-companion Local MCP Server v4.0...');

  // Perform quick pre-flight healthcheck
  const health = runHealthCheck();
  if (!health.checks.node || !health.checks.git) {
    Logger.error('Healthcheck failed on startup. Please run "npm run setup" first.', health.messages);
  }

  const server = new Server(
    {
      name: 'mcp-pr-companion',
      version: '4.0.0'
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
          name: 'get_pr_context_pack',
          description: 'PRIMARY AI ENTRYPOINT: Retrieves adaptive Markdown Context Pack (context.md) for a PR containing identity, read strategy, executive summary, changed files, and impact map.',
          inputSchema: {
            type: 'object',
            properties: {
              pr_url: { type: 'string', description: 'Full Bitbucket PR URL.' },
              refresh: { type: 'boolean', description: 'Force re-fetching from Bitbucket API. Defaults to false.' },
              detail_level: { type: 'string', enum: ['auto', 'skim', 'standard', 'deep'], description: 'Context detail level. Defaults to auto.' }
            },
            required: ['pr_url']
          }
        },
        {
          name: 'get_pr_file_context',
          description: 'Retrieves Markdown AI detail file for a specific changed file by file_id (e.g. "file_0001") containing classification, risk evidence, symbols, hunk summary, and diff patch.',
          inputSchema: {
            type: 'object',
            properties: {
              pr_url: { type: 'string', description: 'Full Bitbucket PR URL.' },
              file_id: { type: 'string', description: 'File ID string from manifest or context.md (e.g. "file_0001").' }
            },
            required: ['pr_url', 'file_id']
          }
        },
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
          description: 'Retrieves compact Schema v4 JSON manifest for a synced Bitbucket PR (legacy/technical backing data). Prefer get_pr_context_pack for AI context.',
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
          description: 'Retrieves specific file change details in JSON format by file_id (legacy/technical backing data). Prefer get_pr_file_context for AI context.',
          inputSchema: {
            type: 'object',
            properties: {
              pr_url: { type: 'string', description: 'Full Bitbucket PR URL.' },
              file_id: { type: 'string', description: 'File ID string from manifest file list (e.g. "file_0001"). Numeric fallback supported.' },
              include_patch: { type: 'boolean', description: 'Include raw patch.diff content. Defaults to true.' },
              max_bytes: { type: 'number', description: 'Maximum patch bytes limit before truncating. Defaults to 16000.' }
            },
            required: ['pr_url', 'file_id']
          }
        },
        {
          name: 'search_pr_files',
          description: 'Searches changed files in a PR with filters (path, language, status, change_kind, risk_tag).',
          inputSchema: {
            type: 'object',
            properties: {
              pr_url: { type: 'string', description: 'Full Bitbucket PR URL.' },
              path: { type: 'string', description: 'Filter files matching path string.' },
              language: { type: 'string', description: 'Filter files matching language.' },
              status: { type: 'string', description: 'Filter status (added, modified, deleted, renamed).' },
              change_kind: { type: 'string', description: 'Filter change kind (comment_only, functional_logic, configuration, etc.).' },
              risk_tag: { type: 'string', description: 'Filter files with specific risk tag (public_api, auth_security, etc.).' },
              limit: { type: 'number', description: 'Maximum number of results to return. Defaults to 50.' }
            },
            required: ['pr_url']
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
      if (name === 'get_pr_context_pack') {
        const { pr_url, refresh, detail_level } = (args || {}) as any;
        const markdown = await PRContextService.getContextPack(pr_url, Boolean(refresh), detail_level);
        return { content: [{ type: 'text', text: markdown }] };
      }

      if (name === 'get_pr_file_context') {
        const { pr_url, file_id } = (args || {}) as any;
        const markdown = await PRContextService.getFileContext(pr_url, file_id);
        return { content: [{ type: 'text', text: markdown }] };
      }

      if (name === 'generate_pr_payload') {
        return await handleGeneratePRPayload(args);
      }

      if (name === 'get_pr_manifest') {
        const { pr_url, refresh } = (args || {}) as any;
        const manifest = await PRContextService.getManifest(pr_url, Boolean(refresh));
        return { content: [{ type: 'text', text: JSON.stringify(manifest, null, 2) }] };
      }

      if (name === 'get_pr_file_changes') {
        const { pr_url, file_id, include_patch, max_bytes } = (args || {}) as any;
        const detail = await PRContextService.getFileChange(
          pr_url,
          file_id,
          include_patch !== false,
          max_bytes || 16000
        );
        return { content: [{ type: 'text', text: JSON.stringify(detail || { error: 'File detail not found' }, null, 2) }] };
      }

      if (name === 'search_pr_files') {
        const { pr_url, path, language, status, change_kind, risk_tag, limit } = (args || {}) as any;
        const result = PRContextService.searchPRFiles(pr_url, { path, language, status, change_kind, risk_tag, limit });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      if (name === 'get_pr_sync_status') {
        const { pr_url } = (args || {}) as any;
        const status = PRContextService.getSyncStatus(pr_url);
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      }

      if (name === 'refresh_pr_data') {
        const { pr_url } = (args || {}) as any;
        const manifest = await PRContextService.refreshPRData(pr_url);
        return { content: [{ type: 'text', text: JSON.stringify(manifest, null, 2) }] };
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
  Logger.info('mcp-pr-companion MCP Server v4.0 is running over stdio transport.');
}

startServer().catch((err) => {
  Logger.error('Fatal error starting mcp-pr-companion MCP Server:', err);
  process.exit(1);
});
