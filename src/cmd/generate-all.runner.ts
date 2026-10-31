import { pathToFileURL } from 'url';
import { SecureShutdown } from '../core/auth/secure-shutdown.js';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { LoginScreen } from './login.screen.js';
import { GenerateAllService } from '../core/orchestration/generate-all.service.js';
import { GenerationProgressRenderer } from './generation-progress.renderer.js';
import { LogRedactor } from '../core/logging/log.redactor.js';
import { ConfigManager } from '../config/config.manager.js';

interface RepoSummary {
  repository: string;
  status: 'ok' | 'auth_failed' | 'error';
  discovered: number;
  completed: number;
  cached: number;
  failed: number;
  logFilePath?: string;
  error?: string;
}

/** Generates context packs for every open PR in every repository listed in BITBUCKET_REPOSITORY. */
export async function runGenerateAll(): Promise<number> {
  SecureShutdown.registerSignalHandlers();

  const { repositories } = ConfigManager.credentials();
  if (repositories.length === 0) {
    console.error(`Missing configuration (.env or the Hub's bitbucket block): BITBUCKET_REPOSITORY`);
    return 1;
  }

  const summaries: RepoSummary[] = [];

  for (const repository of repositories) {
    const summary: RepoSummary = { repository, status: 'ok', discovered: 0, completed: 0, cached: 0, failed: 0 };
    summaries.push(summary);

    try {
      // Credentials come from .env or the Hub's bitbucket block; login runs the full capability probe for this repository.
      const session = (await LoginScreen.executeLoginFlow(repository)) && runtimeSession.getSession();
      if (!session) {
        summary.status = 'auth_failed';
        continue;
      }

      console.log(`\nGenerating PR data for ${repository}...\n`);
      const result = await GenerateAllService.execute(session, {
        readiness: 'all',
        forceRefresh: false,
        concurrency: 2,
        onProgress: (progress) => GenerationProgressRenderer.render(progress)
      });

      summary.discovered = result.totalFiltered;
      summary.completed = result.completed;
      summary.cached = result.cached;
      summary.failed = result.failed;
      summary.logFilePath = result.logFilePath || undefined;
    } catch (error: any) {
      const errorMsg = error instanceof Error ? error.stack || error.message : String(error);
      summary.status = 'error';
      summary.error = LogRedactor.redactString(errorMsg);
    }
  }

  const account = ConfigManager.credentials().email;
  console.log('\n========================================================');
  console.log('          GENERATION SUMMARY — ONE COMMAND              ');
  console.log('========================================================');
  console.log(`Account: ${account}\n`);
  for (const s of summaries) {
    if (s.status === 'auth_failed') {
      console.log(`✗ ${s.repository}: authentication / access check failed (see log above)`);
    } else if (s.status === 'error') {
      console.log(`✗ ${s.repository}: ${s.error}`);
    } else {
      const mark = s.failed > 0 ? '✗' : '✓';
      console.log(`${mark} ${s.repository}: ${s.discovered} PR(s) | completed ${s.completed} | cached ${s.cached} | failed ${s.failed}`);
      if (s.logFilePath) console.log(`    Log: ${s.logFilePath}`);
    }
  }
  console.log('\nCompleted:  ' + summaries.reduce((n, s) => n + s.completed, 0));
  console.log('Failed:     ' + summaries.reduce((n, s) => n + s.failed, 0));
  console.log('========================================================\n');

  if (summaries.some(s => s.status !== 'ok')) return 1;
  if (summaries.some(s => s.failed > 0)) return 2;
  return 0;
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
