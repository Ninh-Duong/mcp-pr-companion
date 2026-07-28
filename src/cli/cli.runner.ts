import { PayloadBuilder } from '../core/generator/payload.builder.js';
import { Logger } from '../utils/logger.js';

export async function runCLI(args: string[]) {
  console.log('\n🚀 [MCP-PR-COMPANION] Starting Manual CLI Payload Generation...\n');

  let prUrl: string | undefined;
  let sourceBranch: string | undefined;
  let targetBranch: string | undefined;
  let repoPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--url' || arg === '-u') {
      prUrl = args[i + 1];
      i++;
    } else if (arg === '--source' || arg === '-s') {
      sourceBranch = args[i + 1];
      i++;
    } else if (arg === '--target' || arg === '-t') {
      targetBranch = args[i + 1];
      i++;
    } else if (arg === '--repo' || arg === '-r') {
      repoPath = args[i + 1];
      i++;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  // If a positional argument looking like a URL is passed (e.g. npx mcp-pr-companion https://bitbucket.org/...)
  if (!prUrl) {
    const urlArg = args.find(a => a.startsWith('http://') || a.startsWith('https://'));
    if (urlArg) {
      prUrl = urlArg;
    }
  }

  try {
    const payload = await PayloadBuilder.build({
      prUrl,
      sourceBranch,
      targetBranch,
      repoPath
    });

    console.log('\n=========================================================');
    console.log('🎉 JSON Payload Generated Successfully!');
    console.log(`💾 Saved to File: ${payload._metadata?.saved_file_path}`);
    console.log('=========================================================\n');
    console.log(JSON.stringify(payload, null, 2));
    console.log('\n');
  } catch (err: any) {
    Logger.error('❌ CLI execution failed:', err.message || err);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
Usage:
  npm run generate -- [options]
  npx mcp-pr-companion [options]

Options:
  -u, --url <url>        Bitbucket PR URL (e.g., https://bitbucket.org/workspace/repo/pull-requests/123)
  -s, --source <branch>  Source branch name (e.g., feature/WCE-815)
  -t, --target <branch>  Target branch name (e.g., main or release/staging)
  -r, --repo <path>      Path to local Git repository
  -h, --help             Show this help menu

Examples:
  npm run generate -- --url https://bitbucket.org/workspace/repo/pull-requests/123
  npm run generate -- --source feature/WCE-815 --target main
`);
}

// If executed directly
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.runner.ts') || process.argv[1]?.endsWith('cli.runner.js')) {
  runCLI(process.argv.slice(2));
}
