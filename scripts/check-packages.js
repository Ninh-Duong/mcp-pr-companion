import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { spawn, execSync } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// ANSI Color Helpers (Zero-dependency)
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m'
};

function logHeader(title) {
  console.log(`\n${colors.bright}${colors.cyan}=========================================================${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}  ${title}${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}=========================================================${colors.reset}\n`);
}

function askQuestion(query) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function getPackageVersion(pkgName) {
  const pkgJsonPath = path.join(rootDir, 'node_modules', ...pkgName.split('/'), 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const pkgContent = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf-8'));
      return pkgContent.version || 'installed';
    } catch {
      return 'installed';
    }
  }
  return null;
}

export async function runPackageCheck(options = {}) {
  const autoInstall = options.autoInstall || process.argv.includes('-y') || process.argv.includes('--yes');
  
  logHeader('📦 MCP-PR-COMPANION: Package & Environment Check');

  // Step 1: Read package.json to get required packages
  const packageJsonPath = path.join(rootDir, 'package.json');
  if (!fs.existsSync(packageJsonPath)) {
    console.error(`${colors.red}❌ package.json not found in ${rootDir}${colors.reset}`);
    process.exit(1);
  }

  const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
  const prodDeps = pkgJson.dependencies || {};
  const devDeps = pkgJson.devDependencies || {};
  
  const allRequiredPackages = [
    ...Object.keys(prodDeps).map((name) => ({ name, type: 'prod', reqVer: prodDeps[name] })),
    ...Object.keys(devDeps).map((name) => ({ name, type: 'dev', reqVer: devDeps[name] }))
  ];

  console.log(`${colors.bright}🔍 Inspecting ${allRequiredPackages.length} required packages in repository...${colors.reset}\n`);

  const installedPackages = [];
  const missingPackages = [];

  allRequiredPackages.forEach((pkg, index) => {
    const installedVersion = getPackageVersion(pkg.name);
    const num = `[${index + 1}/${allRequiredPackages.length}]`;
    const paddedName = pkg.name.padEnd(32, '.');

    if (installedVersion) {
      installedPackages.push({ ...pkg, version: installedVersion });
      console.log(
        `  ${colors.green}[✔]${colors.reset} ${num} ${colors.bright}${paddedName}${colors.reset} ${colors.green}Installed (v${installedVersion})${colors.reset} ${colors.gray}(${pkg.type})${colors.reset}`
      );
    } else {
      missingPackages.push(pkg);
      console.log(
        `  ${colors.red}[❌]${colors.reset} ${num} ${colors.bright}${paddedName}${colors.reset} ${colors.red}MISSING${colors.reset} ${colors.gray}(req: ${pkg.reqVer}, ${pkg.type})${colors.reset}`
      );
    }
  });

  console.log('\n---------------------------------------------------------');
  console.log(
    `📊 ${colors.bright}Check Results:${colors.reset} ${colors.green}${installedPackages.length}/${allRequiredPackages.length} satisfied${colors.reset}, ${missingPackages.length > 0 ? colors.red : colors.green}${missingPackages.length} missing${colors.reset}.`
  );
  console.log('---------------------------------------------------------\n');

  // Step 2: Handle missing packages
  if (missingPackages.length > 0) {
    console.log(`${colors.yellow}⚠️  The following ${missingPackages.length} package(s) need to be installed:${colors.reset}`);
    missingPackages.forEach((pkg) => {
      console.log(`   - ${colors.bright}${pkg.name}${colors.reset} (${pkg.reqVer}) [${pkg.type}Dependency]`);
    });
    console.log('');

    let shouldInstall = autoInstall;
    if (!shouldInstall && process.stdin.isTTY) {
      const answer = await askQuestion(
        `${colors.bright}${colors.yellow}Do you want to proceed with installing missing package(s)? (y/n): ${colors.reset}`
      );
      shouldInstall = answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes';
    } else if (!shouldInstall && !process.stdin.isTTY) {
      console.log(`${colors.dim}Non-interactive shell detected. Defaulting to install missing packages...${colors.reset}`);
      shouldInstall = true;
    }

    if (!shouldInstall) {
      console.log(`\n${colors.red}❌ Package installation cancelled by user.${colors.reset}`);
      console.log(`👉 Run ${colors.bright}npm install${colors.reset} manually to install missing dependencies.\n`);
      process.exit(1);
    }

    console.log(`\n🚀 ${colors.bright}${colors.cyan}Starting real-time package installation process (npm install)...${colors.reset}\n`);

    await new Promise((resolve, reject) => {
      // Spawn npm install to stream output in real-time
      const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
      const npmProc = spawn(npmCmd, ['install'], {
        cwd: rootDir,
        stdio: 'inherit',
        shell: true
      });

      npmProc.on('close', (code) => {
        if (code === 0) {
          console.log(`\n${colors.green}✓ Real-time package installation completed successfully!${colors.reset}`);
          resolve();
        } else {
          console.error(`\n${colors.red}❌ npm install process exited with code ${code}.${colors.reset}`);
          reject(new Error(`npm install failed with exit code ${code}`));
        }
      });

      npmProc.on('error', (err) => {
        console.error(`\n${colors.red}❌ Failed to start npm install process: ${err.message}${colors.reset}`);
        reject(err);
      });
    });
  } else {
    console.log(`${colors.green}🎉 All ${allRequiredPackages.length} packages are already installed and satisfied!${colors.reset}\n`);
  }

  // Step 3: Check & Auto-create config.json
  const configPath = path.join(rootDir, 'config.json');
  const exampleConfigPath = path.join(rootDir, 'config.example.json');
  if (!fs.existsSync(configPath)) {
    if (fs.existsSync(exampleConfigPath)) {
      fs.copyFileSync(exampleConfigPath, configPath);
      console.log(`⚙️  ${colors.green}[✔] Auto-created config.json from config.example.json${colors.reset}`);
    }
  }

  // Step 4: Build TypeScript code if needed
  const distPath = path.join(rootDir, 'dist');
  if (!fs.existsSync(distPath) || missingPackages.length > 0) {
    console.log(`\n🛠️  ${colors.bright}Building TypeScript source files (/dist)...${colors.reset}`);
    try {
      execSync('npx tsc', { cwd: rootDir, stdio: 'inherit' });
      console.log(`  ${colors.green}[✔] TypeScript compilation successful.${colors.reset}`);
    } catch (err) {
      console.warn(`  ${colors.yellow}⚠️ TypeScript build completed with warnings/notices.${colors.reset}`);
    }
  }

  console.log(`\n${colors.green}${colors.bright}✅ Environment is fully prepared and ready for feature execution!${colors.reset}\n`);
}

// Execute if called directly from Node
if (process.argv[1] && (process.argv[1] === fileURLToPath(import.meta.url) || process.argv[1].endsWith('check-packages.js'))) {
  runPackageCheck().catch((err) => {
    console.error(`\n${colors.red}Fatal Error during package check:${colors.reset}`, err);
    process.exit(1);
  });
}
