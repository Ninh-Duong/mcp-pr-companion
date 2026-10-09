// Runs every tests/*.test.ts in its own temp working directory so tests never
// touch the real .mcp-pr-companion/ (session.json) or ai-context/ folders.
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const testsDir = path.dirname(fileURLToPath(import.meta.url));
const tsxCli = path.resolve(testsDir, '..', 'node_modules', 'tsx', 'dist', 'cli.mjs');
const files = fs.readdirSync(testsDir).filter(f => f.endsWith('.test.ts')).sort();

for (const file of files) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-pr-test-'));
  const { status } = spawnSync(process.execPath, [tsxCli, path.join(testsDir, file)], { cwd, stdio: 'inherit' });
  fs.rmSync(cwd, { recursive: true, force: true });
  if (status !== 0) {
    console.error(`\n✗ ${file} failed`);
    process.exit(1);
  }
}
console.log(`\n✓ ${files.length} test files passed`);
