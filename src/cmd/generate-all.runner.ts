import { pathToFileURL } from 'url';
import { confirm } from '@inquirer/prompts';
import { SecureShutdown } from '../core/auth/secure-shutdown.js';
import { SessionStore } from '../core/auth/session.store.js';
import { runtimeSession, RuntimeSession } from '../core/auth/runtime-session.js';
import { LoginScreen } from './login.screen.js';
import { TokenVerifyScreen } from './token-verify.screen.js';
import { GenerateAllService, GenerateAllResult } from '../core/orchestration/generate-all.service.js';
import { GenerationProgressRenderer } from './generation-progress.renderer.js';
import { LogRedactor } from '../core/logging/log.redactor.js';

export async function runGenerateAll(): Promise<number> {
  SecureShutdown.registerSignalHandlers();

  let session: RuntimeSession | null = null;

  try {
    const existing = SessionStore.loadValidSession();
    if (existing) {
      console.clear();
      console.log('========================================================');
      console.log('            MCP PR COMPANION — ONE COMMAND              ');
      console.log('========================================================');
      console.log(`📌 Active Session Detected:`);
      console.log(`   Account   : ${existing.session.email}`);
      console.log(`   Repo      : ${existing.session.repository.workspace}/${existing.session.repository.repoSlug}`);
      console.log(`   TTL       : Valid for ${existing.remainingMinutes} minute(s)`);
      console.log('--------------------------------------------------------\n');

      const useExisting = await confirm({
        message: `Use active session ${existing.session.email} for ${existing.session.repository.workspace}/${existing.session.repository.repoSlug}?`,
        default: true
      });

      if (useExisting) {
        runtimeSession.setSession(existing.session);
        session = existing.session;
      } else {
        SessionStore.clearSession();
        session = await LoginScreen.executeLoginFlow();
      }
    } else {
      session = await LoginScreen.executeLoginFlow();
    }

    if (!session) {
      console.log('\nOperation cancelled by user.');
      return 130;
    }

    const tokenValid = await TokenVerifyScreen.verifyOrUpdateToken();
    if (tokenValid !== 'valid') {
      console.log('\nToken verification failed or cancelled by user.');
      return tokenValid === 'cancelled' ? 130 : 1;
    }

    // Refresh active session reference in case token was updated
    const activeSession = runtimeSession.getSession();
    if (!activeSession) {
      console.log('\nNo active authenticated session.');
      return 1;
    }

    console.log('\nStarting PR data generation orchestration...\n');

    const result: GenerateAllResult = await GenerateAllService.execute(activeSession, {
      readiness: 'all',
      forceRefresh: false,
      concurrency: 2,
      strategy: 'overwrite',
      onProgress: (progress) => {
        GenerationProgressRenderer.render(progress);
      }
    });

    console.log('\n========================================================');
    console.log('          GENERATION SUMMARY — ONE COMMAND              ');
    console.log('========================================================');
    console.log(`Account:    ${activeSession.email}`);
    console.log(`Repository: ${activeSession.repository.workspace}/${activeSession.repository.repoSlug}`);
    console.log(`Discovered: ${result.totalDiscovered} PR(s)`);
    console.log(`Filtered:   ${result.totalFiltered} PR(s)`);
    console.log(`Completed:  ${result.completed}`);
    console.log(`Cached:     ${result.cached}`);
    console.log(`Failed:     ${result.failed}`);
    if (result.logFilePath) {
      console.log(`Log:        ${result.logFilePath}`);
    }
    console.log('========================================================\n');

    if (result.totalFiltered === 0) {
      console.log('No open pull requests owned by the authenticated user.');
      console.log('Nothing to generate.');
      return 0;
    }

    if (result.failed > 0) {
      return 2;
    }

    return 0;
  } catch (error: any) {
    const errorMsg = error instanceof Error ? error.stack || error.message : String(error);
    console.error('\nFatal Error in One-Command Runner:', LogRedactor.redactString(errorMsg));
    return 1;
  }
}

const isDirectExecution =
  process.argv[1] &&
  (import.meta.url === pathToFileURL(process.argv[1]).href ||
    process.argv[1].endsWith('generate-all.runner.ts') ||
    process.argv[1].endsWith('generate-all.runner.js'));

if (isDirectExecution) {
  runGenerateAll().then((code) => {
    process.exit(code);
  });
}
