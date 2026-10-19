// Logger: redacts secrets, writes Logs/mcp-server.log in the cwd, rotates past MAX_LOG_BYTES.
import assert from 'node:assert/strict';
import fs from 'fs';
import { Logger } from '../src/utils/logger.ts';

const file = 'Logs/mcp-server.log';
fs.mkdirSync('Logs', { recursive: true });
fs.writeFileSync(file, 'x'.repeat(Logger.MAX_LOG_BYTES + 1));

Logger.info('token ATATT3xFfGF0abcdefghijklmnopqrstuvwxyz');

assert.ok(fs.existsSync(`${file}.1`), 'oversized log moved to .1');
const fresh = fs.readFileSync(file, 'utf-8');
assert.ok(fresh.length < 200 && !fresh.includes('ATATT3x'), 'new file holds only the redacted line');
console.log('  ✓ Logger rotates at MAX_LOG_BYTES and redacts tokens');
