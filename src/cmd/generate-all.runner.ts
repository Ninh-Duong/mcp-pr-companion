import { pathToFileURL } from 'url';
import { SecureShutdown } from '../core/auth/secure-shutdown.js';
import { runtimeSession, RuntimeSession } from '../core/auth/runtime-session.js';
import { LoginScreen } from './login.screen.js';
import { GenerateAllService, GenerateAllResult } from '../core/orchestration/generate-all.service.js';
import { GenerationProgressRenderer } from './generation-progress.renderer.js';
import { LogRedactor } from '../core/logging/log.redactor.js';

export async function runGenerateAll(): Promise<number> {
  SecureShutdown.registerSignalHandlers();

  let session: RuntimeSession | null = null;

  try {
    // Credentials come from .env; login already runs the full capability probe.
    session = await LoginScreen.executeLoginFlow();
    const activeSession = session && runtimeSession.getSession();
    if (!activeSession) {
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
