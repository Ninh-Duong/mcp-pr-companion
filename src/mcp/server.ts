import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { PRContextService } from './context.service.js';
import { runHealthCheck } from '../healthcheck/healthcheck.js';
import { Logger } from '../utils/logger.js';
import { z } from 'zod';

// One schema for every tool: each tool reads only the fields it needs.
const ToolArgsSchema = z.object({
  pr_url: z.string().min(1),
  refresh: z.boolean().optional(),
  detail_level: z.enum(['auto', 'skim', 'standard', 'deep']).optional(),
  file_id: z.union([z.string(), z.number().int().nonnegative()]).optional(),
  include_patch: z.boolean().optional(),
  max_bytes: z.number().int().min(1).max(1_000_000).optional(),
  path: z.string().optional(),
  language: z.string().optional(),
  status: z.string().optional(),
  change_kind: z.string().optional(),
  risk_tag: z.string().optional(),
  limit: z.number().int().min(1).max(1000).optional()
});

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
      const a = ToolArgsSchema.parse(args ?? {});
      const fileId = () => {
        if (a.file_id === undefined) throw new Error('file_id is required.');
        return a.file_id;
      };

      if (name === 'get_pr_context_pack') {
        const markdown = await PRContextService.getContextPack(a.pr_url, Boolean(a.refresh), a.detail_level);
        return { content: [{ type: 'text', text: markdown }] };
      }

      if (name === 'get_pr_file_context') {
        const markdown = await PRContextService.getFileContext(a.pr_url, fileId());
        return { content: [{ type: 'text', text: markdown }] };
      }

      if (name === 'get_pr_manifest') {
        const manifest = await PRContextService.getManifest(a.pr_url, Boolean(a.refresh));
        return { content: [{ type: 'text', text: JSON.stringify(manifest, null, 2) }] };
      }

      if (name === 'get_pr_file_changes') {
        const detail = await PRContextService.getFileChange(
          a.pr_url,
          fileId(),
          a.include_patch !== false,
          a.max_bytes ?? 16000
        );
        return { content: [{ type: 'text', text: JSON.stringify(detail || { error: 'File detail not found' }, null, 2) }] };
      }

      if (name === 'search_pr_files') {
        const result = PRContextService.searchPRFiles(a.pr_url, { path: a.path, language: a.language, status: a.status, change_kind: a.change_kind, risk_tag: a.risk_tag, limit: a.limit });
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
      }

      if (name === 'get_pr_sync_status') {
        const status = PRContextService.getSyncStatus(a.pr_url);
        return { content: [{ type: 'text', text: JSON.stringify(status, null, 2) }] };
      }

      if (name === 'refresh_pr_data') {
        const manifest = await PRContextService.refreshPRData(a.pr_url);
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
