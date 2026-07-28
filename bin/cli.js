#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
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
