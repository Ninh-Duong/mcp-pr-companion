import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './tools.js';
import { Logger } from '../utils/logger.js';

// Entry point (bin/cli.js server). stdout is the JSON-RPC stream: log through Logger only.
createServer()
  .connect(new StdioServerTransport())
  .then(() => Logger.info('mcp-pr-companion MCP server running over stdio.'))
  .catch(err => {
    Logger.error('Fatal error starting mcp-pr-companion MCP server:', err);
    process.exit(1);
  });
