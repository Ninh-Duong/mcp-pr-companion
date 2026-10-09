#!/usr/bin/env node
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const child = spawn('node', [path.join(rootDir, 'dist', 'mcp', 'server.js')], { cwd: rootDir, stdio: 'inherit' });

child.on('error', (err) => {
  console.error('Failed to start mcp-pr-companion server:', err);
  process.exit(1);
});
child.on('exit', (code) => process.exit(code ?? 0));
