#!/usr/bin/env node
// Bootstrap for mcp-pr-companion. Before starting the app it makes sure that:
//   1. Node.js satisfies package.json "engines"
//   2. node_modules matches package-lock.json   (otherwise: npm ci)
//   3. dist/ matches the current sources        (otherwise: npm run build)
//   4. .env provides the required settings       (otherwise: create it from .env.example and stop)
// Only Node built-ins are used so this runs on a fresh clone. Every message goes to stderr:
// stdout belongs to the MCP JSON-RPC stream when running the server.
//
// Usage: node bin/cli.js [server|cmd|generate-all|check|prepare]   (default: server)
import { spawn, spawnSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf-8'));

const ENTRIES = {
  server: 'dist/mcp/server.js',
  cmd: 'dist/cmd/cmd.runner.js',
  'generate-all': 'dist/cmd/generate-all.runner.js'
};
const CREDENTIALS = ['BITBUCKET_EMAIL', 'BITBUCKET_API_TOKEN'];
const REQUIRED_ENV = {
  server: CREDENTIALS,
  cmd: [...CREDENTIALS, 'BITBUCKET_REPOSITORY'],
  'generate-all': [...CREDENTIALS, 'BITBUCKET_REPOSITORY'],
  check: [...CREDENTIALS, 'BITBUCKET_REPOSITORY']
};

const LOCK_STAMP = path.join(root, 'node_modules', '.mcp-pr-lock.sha256');
const BUILD_STAMP = path.join(root, 'dist', '.build-stamp');
const ENV_FILE = path.join(root, '.env');
const ENV_EXAMPLE = path.join(root, '.env.example');

const log = msg => process.stderr.write(`[mcp-pr-companion] ${msg}\n`);

function sha256(...files) {
  const hash = crypto.createHash('sha256');
  for (const f of files) hash.update(path.relative(root, f)).update(fs.readFileSync(f));
  return hash.digest('hex');
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap(e => (e.isDirectory() ? listFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]))
    .sort();
}

const readStamp = file => (fs.existsSync(file) ? fs.readFileSync(file, 'utf-8').trim() : '');

// npm is npm.cmd on Windows, which Node only spawns through a shell.
function npm(args) {
  log(`$ npm ${args.join(' ')}`);
  const res = spawnSync('npm', args, { cwd: root, shell: true, stdio: ['ignore', 2, 2] });
  return res.status === 0;
}

// ---- checks: each returns { ok, detail } -------------------------------------------------

function checkNode() {
  const min = (pkg.engines?.node || '>=20.12').replace(/[^\d.]/g, '').split('.').map(Number);
  const cur = process.versions.node.split('.').map(Number);
  const ok = cur[0] > min[0] || (cur[0] === min[0] && (cur[1] ?? 0) >= (min[1] ?? 0));
  return { ok, detail: `Node.js ${process.versions.node} (requires ${pkg.engines?.node})` };
}

function checkDeps() {
  const ok = fs.existsSync(path.join(root, 'node_modules')) && readStamp(LOCK_STAMP) === sha256(path.join(root, 'package-lock.json'));
  return { ok, detail: ok ? 'dependencies match package-lock.json' : 'dependencies missing or out of date' };
}

function sourceHash() {
  return sha256(...listFiles(path.join(root, 'src')), path.join(root, 'tsconfig.json'), path.join(root, 'package-lock.json'));
}

function checkBuild() {
  const entriesExist = Object.values(ENTRIES).every(e => fs.existsSync(path.join(root, e)));
  const ok = entriesExist && readStamp(BUILD_STAMP) === sourceHash();
  return { ok, detail: ok ? 'dist/ is up to date' : 'dist/ missing or older than src/' };
}

// Real environment variables win over .env (process.loadEnvFile never overrides them).
function checkEnv(command) {
  if (fs.existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const missing = (REQUIRED_ENV[command] || []).filter(k => !(process.env[k] || '').trim());
  return {
    ok: missing.length === 0,
    missing,
    detail: missing.length === 0 ? 'required settings present' : `missing in .env: ${missing.join(', ')}`
  };
}

// ---- fixes -------------------------------------------------------------------------------

function ensureDeps() {
  if (checkDeps().ok) return;
  log('Installing dependencies (npm ci)...');
  if (!npm(['ci', '--no-audit', '--no-fund'])) {
    throw new Error('npm ci failed. Check the network connection / npm registry access and run again.');
  }
  fs.writeFileSync(LOCK_STAMP, sha256(path.join(root, 'package-lock.json')));
}

function ensureBuild() {
  if (checkBuild().ok) return;
  log('Building TypeScript sources (npm run build)...');
  if (!npm(['run', 'build'])) throw new Error('Build failed (see TypeScript errors above).');
  fs.writeFileSync(BUILD_STAMP, sourceHash());
}

function ensureEnv(command) {
  const env = checkEnv(command);
  if (env.ok) return;
  if (!fs.existsSync(ENV_FILE)) {
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE);
    log(`Created ${ENV_FILE} from .env.example.`);
  }
  throw new Error(`Fill in ${env.missing.join(', ')} in ${ENV_FILE} and run again.`);
}

// ---- main --------------------------------------------------------------------------------

const command = process.argv[2] || 'server';
const known = [...Object.keys(ENTRIES), 'check', 'prepare'];
if (!known.includes(command)) {
  log(`Unknown command "${command}". Use one of: ${known.join(', ')}`);
  process.exit(1);
}

const node = checkNode();
if (!node.ok) {
  log(`✗ ${node.detail}. Run run.cmd (Windows) or ./run.sh (Linux/macOS) to install a supported Node.js.`);
  process.exit(1);
}

if (command === 'check') {
  const results = [['Node.js', node], ['Dependencies', checkDeps()], ['Build', checkBuild()], ['Config (.env)', checkEnv('check')]];
  for (const [name, r] of results) log(`${r.ok ? '✓' : '✗'} ${name}: ${r.detail}`);
  process.exit(results.every(([, r]) => r.ok) ? 0 : 1);
}

try {
  ensureDeps();
  ensureBuild();
  if (command === 'prepare') {
    log('✓ Dependencies installed and build is up to date.');
    process.exit(0);
  }
  ensureEnv(command);
} catch (err) {
  log(`✗ ${err.message}`);
  process.exit(1);
}

const child = spawn(process.execPath, [path.join(root, ENTRIES[command]), ...process.argv.slice(3)], {
  cwd: root,
  stdio: 'inherit',
  env: process.env
});
child.on('error', err => {
  log(`✗ Failed to start ${command}: ${err.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
