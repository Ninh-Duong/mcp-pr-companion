import { pathToFileURL } from 'url';
import { SecureShutdown } from '../core/auth/secure-shutdown.js';
import { runtimeSession } from '../core/auth/runtime-session.js';
import { LoginScreen } from './login.screen.js';
import { SyncPRsService } from '../core/orchestration/sync-prs.service.js';
import { GenerationProgressRenderer } from './generation-progress.renderer.js';
import { LogRedactor } from '../core/logging/log.redactor.js';
import { ConfigManager } from '../config/config.manager.js';
import { PRSyncMode, PR_STORAGE_STATUSES } from '../core/pr-status.js';

const usage = 'Usage: node bin/cli.js sync <open|draft|merged|declined|all>';

export function parseSyncMode(value?: string): PRSyncMode {
  if (value === 'all' || (PR_STORAGE_STATUSES as readonly string[]).includes(value || '')) return value as PRSyncMode;
  throw new Error(`${usage}\nModes: open, draft, merged, declined, all.`);
}

interface RepositorySummary {
  repository: string;
  status: 'ok' | 'auth_failed' | 'error';
  discovered: number;
  completed: number;
  cached: number;
  failed: number;
  failedPRs: Array<{ id: number; error: string }>;
  incomplete: boolean;
  error?: string;
}

export async function runSync(modeArg = process.argv[2]): Promise<number> {
  let mode: PRSyncMode;
  try {
    mode = parseSyncMode(modeArg);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }

  SecureShutdown.registerSignalHandlers();
  const { repositories } = ConfigManager.credentials();
  if (repositories.length === 0) {
    console.error(`Missing configuration (.env or the Hub's bitbucket block): BITBUCKET_REPOSITORY`);
    return 1;
  }

  const summaries: RepositorySummary[] = [];
  for (const repository of repositories) {
    const summary: RepositorySummary = { repository, status: 'ok', discovered: 0, completed: 0, cached: 0, failed: 0, failedPRs: [], incomplete: false };
    summaries.push(summary);
    try {
      const session = (await LoginScreen.executeLoginFlow(repository)) && runtimeSession.getSession();
      if (!session) {
        summary.status = 'auth_failed';
        continue;
      }
      console.log(`\nSyncing ${mode} PRs for ${repository}...\n`);
      const errorByPR = new Map<number, string>();
      const result = await SyncPRsService.execute(session, mode, {
        concurrency: 2,
        onProgress: progress => {
          GenerationProgressRenderer.render(progress);
          for (const job of progress.jobs.values()) {
            if (job.status === 'failed') errorByPR.set(job.prId, LogRedactor.redactString(job.error || 'Sync failed.'));
          }
        }
      });
      summary.discovered = result.totalFiltered;
      summary.completed = result.completed;
      summary.cached = result.cached;
      summary.failed = result.failed;
      summary.failedPRs = result.failedPRs.map(pr => ({ id: pr.id, error: errorByPR.get(pr.id) || 'Sync failed.' }));
      summary.incomplete = !result.complete;
      if (summary.incomplete) console.error(`⚠ ${repository}: PR discovery incomplete: ${LogRedactor.redactString(result.warnings.join('; ') || 'Bitbucket pagination stopped early.')}`);
    } catch (error) {
      summary.status = 'error';
      summary.error = LogRedactor.redactString(error instanceof Error ? error.message : String(error));
    }
  }

  console.log(`\nSync summary — ${mode.toUpperCase()}`);
  for (const summary of summaries) {
    const mark = summary.status === 'ok' && !summary.failed && !summary.incomplete ? '✓' : '✗';
    const outcome = summary.status === 'auth_failed'
      ? 'authentication / access check failed'
      : summary.status === 'error'
        ? summary.error
        : `${summary.discovered} PR(s) | synced ${summary.completed} | unchanged ${summary.cached} | failed ${summary.failed}${summary.incomplete ? ' | discovery incomplete' : ''}`;
    console.log(`${mark} ${summary.repository}: ${outcome}`);
    for (const failure of summary.failedPRs) console.error(`  PR #${failure.id}: ${failure.error}`);
  }
  return summaries.some(s => s.status !== 'ok') ? 1 : summaries.some(s => s.failed > 0 || s.incomplete) ? 2 : 0;
}

const isDirectExecution = process.argv[1] &&
  (import.meta.url === pathToFileURL(process.argv[1]).href ||
    process.argv[1].endsWith('sync.runner.ts') ||
    process.argv[1].endsWith('sync.runner.js'));

if (isDirectExecution) runSync().then(code => process.exit(code));
