// Catch stale builds after package.json changes and exercise the Hub's actual launch command.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = path.resolve('launcher-fixture');
fs.mkdirSync(fixture);
for (const name of ['bin', 'src', 'package.json', 'package-lock.json', 'tsconfig.json']) {
  fs.cpSync(path.join(root, name), path.join(fixture, name), { recursive: true });
}
// Own the stamp locally; dependency directories are read-only links to the installed packages.
const modules = path.join(fixture, 'node_modules');
fs.mkdirSync(modules);
for (const entry of fs.readdirSync(path.join(root, 'node_modules'), { withFileTypes: true })) {
  if (entry.isDirectory()) fs.symlinkSync(path.join(root, 'node_modules', entry.name), path.join(modules, entry.name), 'junction');
}
const lockHash = createHash('sha256').update('package-lock.json')
  .update(fs.readFileSync(path.join(fixture, 'package-lock.json'))).digest('hex');
fs.writeFileSync(path.join(modules, '.mcp-pr-lock.sha256'), lockHash);

// Keep only OS variables needed to launch Node/npm; never inherit user credentials or NODE_OPTIONS.
const env: NodeJS.ProcessEnv = {};
for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR']) {
  if (process.env[key]) env[key] = process.env[key];
}
Object.assign(env, {
  BITBUCKET_EMAIL: 'launcher@example.com', BITBUCKET_API_TOKEN: 'dummy-launcher-token',
  BITBUCKET_REPOSITORY: 'example/repo', AUTO_SYNC_ON_START: 'false',
  npm_config_update_notifier: 'false', npm_config_offline: 'true'
});
const run = (command: string) => spawnSync(process.execPath, ['bin/cli.js', command], {
  cwd: fixture, env, encoding: 'utf8', timeout: 60_000
});
const prepared = run('prepare');
assert.equal(prepared.status, 0, 'isolated launcher prepare succeeds');
assert.equal(prepared.stdout, '', 'build output stays off stdout');
assert.equal(run('check').status, 0);
const stamp = fs.readFileSync(path.join(fixture, 'dist', '.build-stamp'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(fixture, 'package.json'), 'utf8'));
pkg.description += ' (freshness regression)';
pkg.scripts.build += ' && node -e "require(\'fs\').writeFileSync(\'rebuilt\',\'yes\')"';
fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify(pkg));
const stale = run('check');
assert.equal(stale.status, 1, 'package.json changes invalidate the existing build');
assert.match(stale.stderr, /✗ Build:/);
assert.equal(fs.readFileSync(path.join(fixture, 'dist', '.build-stamp'), 'utf8'), stamp, 'check does not rebuild');
assert.ok(!fs.existsSync(path.join(fixture, 'rebuilt')));
assert.equal(run('prepare').status, 0);
assert.equal(fs.readFileSync(path.join(fixture, 'rebuilt'), 'utf8'), 'yes', 'prepare uses the updated build script');
assert.notEqual(fs.readFileSync(path.join(fixture, 'dist', '.build-stamp'), 'utf8'), stamp);
assert.equal(run('check').status, 0);

// A preload is inherited by the launcher's real child. Any accidental network attempt fails locally.
const guard = path.join(fixture, 'no-network.cjs');
fs.writeFileSync(guard, `
const fs = require('node:fs');
const deny = () => { fs.writeFileSync('network-attempted', 'yes'); throw new Error('Network disabled in launcher test'); };
globalThis.fetch = deny;
for (const name of ['node:http', 'node:https']) {
  const mod = require(name); mod.request = deny; mod.get = deny;
}
require('node:net').Socket.prototype.connect = deny;
require('node:tls').connect = deny;
`);
const child = spawn(process.execPath, ['bin/cli.js', 'server'], {
  cwd: fixture, env: { ...env, NODE_OPTIONS: '--require=./no-network.cjs' }, stdio: ['pipe', 'pipe', 'pipe']
});
const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
let stdout = '';
let stderr = '';
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
child.on('error', () => { /* waitFor reports a missing response without leaking launch arguments. */ });
child.stdin.on('error', () => { /* waitFor handles an early process exit. */ });
const send = (message: object) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
async function waitFor(id: number) {
  for (let attempt = 0; attempt < 300; attempt++) {
    const lines = stdout.split('\n');
    lines.pop();
    for (const line of lines) {
      const message = JSON.parse(line);
      assert.equal(message.jsonrpc, '2.0', 'every stdout line is JSON-RPC');
      if (message.id === id) return message;
    }
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(`launcher did not answer request ${id} (exit: ${child.exitCode})`);
}
try {
  send({ id: 1, method: 'initialize', params: {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'launcher-test', version: '0' }
  } });
  const init = await waitFor(1);
  assert.match(init.result.instructions, /get_pr_context_pack/);
  send({ method: 'notifications/initialized' });
  send({ id: 2, method: 'tools/list' });
  assert.deepEqual((await waitFor(2)).result.tools.map((tool: { name: string }) => tool.name).sort(), [
    'check_bitbucket_connection', 'get_pr_comments', 'get_pr_context_pack', 'get_pr_file_changes',
    'get_pr_file_context', 'get_pr_sync_status', 'list_my_open_prs', 'search_pr_files', 'sync_my_open_prs'
  ]);
} finally {
  child.stdin.end();
  const timer = setTimeout(() => child.kill(), 5_000);
  await closed;
  clearTimeout(timer);
}
assert.equal(child.exitCode, 0, 'launcher exits cleanly on stdin EOF');
assert.equal(stdout.trim().split('\n').length, 2, 'only the requested responses reach stdout');
for (const value of [env.BITBUCKET_EMAIL!, env.BITBUCKET_API_TOKEN!]) {
  assert.ok(!(stdout + stderr).includes(value), 'credentials stay out of transport and diagnostics');
}
assert.ok(!fs.existsSync(path.join(fixture, 'network-attempted')), 'startup and tool listing use no network');
assert.ok(!fs.existsSync(path.join(fixture, '.env')), 'dummy environment needs no .env file');
assert.ok(fs.existsSync(path.join(fixture, 'Logs', 'mcp-server.log')), 'launcher keeps runtime files in its isolated project');
console.log('  ✓ launcher: package freshness + no-network Hub stdio handshake');
