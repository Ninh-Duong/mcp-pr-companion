#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const args = process.argv.slice(2);

// If user passed arguments (e.g. --url, --source, --help, or a Bitbucket URL), run CLI runner
if (args.length > 0) {
  const runnerPath = path.join(rootDir, 'dist', 'cli', 'cli.runner.js');
  const child = spawn('node', [runnerPath, ...args], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  child.on('error', (err) => {
    console.error('Failed to run CLI runner:', err);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
} else {
  // Default: Start MCP Server over Stdio
  const serverPath = path.join(rootDir, 'dist', 'mcp', 'server.js');
  const child = spawn('node', [serverPath], {
    cwd: rootDir,
    stdio: 'inherit'
  });

  child.on('error', (err) => {
    console.error('Failed to start mcp-pr-companion server:', err);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}
