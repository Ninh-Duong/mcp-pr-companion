import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface HealthCheckResult {
  healthy: boolean;
  checks: {
    node: boolean;
    git: boolean;
    config: boolean;
    gitRepo: boolean;
  };
  messages: string[];
}

export function runHealthCheck(repoPath: string = process.cwd()): HealthCheckResult {
  const messages: string[] = [];
  const checks = {
    node: true,
    git: true,
    config: true,
    gitRepo: true
  };

  // Node version check
  const nodeVer = process.version;
  const majorVer = parseInt(nodeVer.slice(1).split('.')[0], 10);
  if (majorVer < 18) {
    checks.node = false;
    messages.push(`Node.js version must be >= 18 (current: ${nodeVer})`);
  }

  // Git CLI check
  try {
    execSync('git --version', { stdio: 'ignore' });
  } catch (err) {
    checks.git = false;
    messages.push('Git CLI is not installed or accessible in PATH');
  }

  // Config check
  const configPath = path.resolve(process.cwd(), 'config.json');
  const examplePath = path.resolve(process.cwd(), 'config.example.json');

  if (!fs.existsSync(configPath)) {
    if (fs.existsSync(examplePath)) {
      try {
        fs.copyFileSync(examplePath, configPath);
        messages.push('Auto-created config.json from config.example.json');
      } catch (e) {
        checks.config = false;
        messages.push('Missing config.json and failed to copy from config.example.json');
      }
    } else {
      checks.config = false;
      messages.push('Missing config.json file');
    }
  }

  // Git Repository check
  try {
    const isRepo = execSync('git rev-parse --is-inside-work-tree', { cwd: repoPath, encoding: 'utf-8' }).trim();
    if (isRepo !== 'true') {
      checks.gitRepo = false;
      messages.push(`Target directory is not a Git repository: ${repoPath}`);
    }
  } catch (e) {
    checks.gitRepo = false;
    messages.push(`Target directory is not inside a valid Git repository: ${repoPath}`);
  }

  const healthy = checks.node && checks.git && checks.config && checks.gitRepo;
  return { healthy, checks, messages };
}

// CLI direct execution
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('healthcheck.ts') || process.argv[1]?.endsWith('healthcheck.js')) {
  console.log('Running Pre-flight Healthcheck...');
  const res = runHealthCheck();
  console.log('Result:', JSON.stringify(res, null, 2));
  if (!res.healthy) {
    process.exit(1);
  }
}
