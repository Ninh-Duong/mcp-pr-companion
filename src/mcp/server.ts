import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './tools.js';
import { PRContextService } from './context.service.js';
import { ConfigManager } from '../config/config.manager.js';
import { Logger } from '../utils/logger.js';

// Entry point (bin/cli.js server). stdout is the JSON-RPC stream: log through Logger only.
createServer()
  .connect(new StdioServerTransport())
  .then(() => {
    Logger.info('mcp-pr-companion MCP server running over stdio.');
    // Not awaited: tool calls are served while it runs; overlapping PR syncs share one fetch.
    if (ConfigManager.loadBase().auto_sync_on_start) void PRContextService.autoSync();
  })
  .catch(err => {
    Logger.error('Fatal error starting mcp-pr-companion MCP server:', err);
    process.exit(1);
  });
