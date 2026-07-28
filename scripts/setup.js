import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

console.log('\n🚀 [MCP-PR-COMPANION] Starting Auto-Setup & Healthcheck...\n');

// Step 1: Check Node.js & Git CLI
console.log('🔍 [1/5] Checking Node.js runtime & Git CLI...');
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
if (majorVersion < 18) {
  console.error(`❌ Node.js version must be >= v18.0.0. Current: ${nodeVersion}`);
  process.exit(1);
}
console.log(`  ✓ Node.js version: ${nodeVersion}`);

try {
  const gitVersion = execSync('git --version', { encoding: 'utf-8' }).trim();
  console.log(`  ✓ Git CLI: ${gitVersion}`);
} catch (err) {
  console.error('❌ Git CLI is not installed or not in PATH.');
  process.exit(1);
}

// Step 2: Check & Install dependencies
console.log('\n📦 [2/5] Checking npm packages (node_modules)...');
const nodeModulesPath = path.join(rootDir, 'node_modules');
if (!fs.existsSync(nodeModulesPath)) {
  console.log('  ⚠️  node_modules missing. Auto-installing dependencies (npm install)...');
  try {
    execSync('npm install', { cwd: rootDir, stdio: 'inherit' });
    console.log('  ✓ Dependencies installed successfully.');
  } catch (err) {
    console.error('❌ Failed to run npm install.');
    process.exit(1);
  }
} else {
  console.log('  ✓ node_modules is already installed.');
}

// Step 3: Check & Auto-create config.json
console.log('\n⚙️  [3/5] Checking configuration files...');
const configPath = path.join(rootDir, 'config.json');
const exampleConfigPath = path.join(rootDir, 'config.example.json');

if (!fs.existsSync(configPath)) {
  if (fs.existsSync(exampleConfigPath)) {
    fs.copyFileSync(exampleConfigPath, configPath);
    console.log('  ✓ Auto-created config.json from config.example.json');
  } else {
    console.error('❌ config.example.json is missing.');
    process.exit(1);
  }
} else {
  console.log('  ✓ config.json is present.');
}

// Step 4: Build TypeScript code
console.log('\n🛠️  [4/5] Building TypeScript source code...');
try {
  execSync('npx tsc', { cwd: rootDir, stdio: 'inherit' });
  console.log('  ✓ TypeScript code compiled successfully into /dist');
} catch (err) {
  console.error('❌ TypeScript build failed.');
  process.exit(1);
}

// Step 5: Final Readiness Check
console.log('\n✅ [5/5] Setup & Healthcheck Complete!');
console.log('---------------------------------------------------------');
console.log('🎉 mcp-pr-companion is fully prepared and ready to run.');
console.log('👉 To run the MCP Server: npm start');
console.log('👉 To test local healthcheck: npm run healthcheck');
console.log('---------------------------------------------------------\n');
