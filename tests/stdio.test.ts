// Spawns the real server entry over stdio: initialize must return instructions, tools/list the
// 5 tools, and every stdout line must be JSON-RPC (anything else would corrupt the hub's stream).
import assert from 'node:assert/strict';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsxCli = path.join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs');

const child = spawn(process.execPath, [tsxCli, path.join(root, 'src', 'mcp', 'server.ts')], {
  stdio: ['pipe', 'pipe', 'ignore']
});

const lines: string[] = [];
const responses = new Map<number, any>();
let buffer = '';
child.stdout.on('data', chunk => {
  buffer += chunk;
  let i;
  while ((i = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, i);
    buffer = buffer.slice(i + 1);
    lines.push(line);
    const msg = JSON.parse(line);
    if (msg.id !== undefined) responses.set(msg.id, msg);
  }
});

const send = (msg: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');
const waitFor = async (id: number) => {
  for (let t = 0; t < 300 && !responses.has(id); t++) await new Promise(r => setTimeout(r, 50));
  assert.ok(responses.has(id), `no response for request ${id}`);
  return responses.get(id);
};

try {
  send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } });
  const init = await waitFor(1);
  assert.match(init.result.instructions, /get_pr_context_pack/);
  assert.ok(init.result.instructions.length < 1500, 'instructions stay well under the 4096-char client limit');
  send({ method: 'notifications/initialized' });

  send({ id: 2, method: 'tools/list' });
  const names = (await waitFor(2)).result.tools.map((t: any) => t.name).sort();
  assert.deepEqual(names, ['get_pr_context_pack', 'get_pr_file_changes', 'get_pr_file_context', 'get_pr_sync_status', 'search_pr_files']);

  for (const line of lines) assert.equal(JSON.parse(line).jsonrpc, '2.0');
  console.log(`  ✓ stdio: initialize + tools/list OK, ${lines.length} stdout lines are all JSON-RPC`);
} finally {
  child.kill();
}
