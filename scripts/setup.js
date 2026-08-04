import { execSync } from 'child_process';
import { runPackageCheck } from './check-packages.js';

console.log('\n🚀 [MCP-PR-COMPANION] Starting Auto-Setup & Healthcheck...\n');

// Step 1: Pre-check Node.js & Git CLI
const nodeVersion = process.version;
const majorVersion = parseInt(nodeVersion.slice(1).split('.')[0], 10);
if (majorVersion < 18) {
  console.error(`❌ Node.js version must be >= v18.0.0. Current: ${nodeVersion}`);
  process.exit(1);
}

try {
  execSync('git --version', { stdio: 'ignore' });
} catch (err) {
  console.error('❌ Git CLI is not installed or not in PATH.');
  process.exit(1);
}

// Step 2: Run Package & Environment Check
await runPackageCheck();
