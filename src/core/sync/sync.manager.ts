import fs from 'fs';
import path from 'path';
import pLimit from 'p-limit';
import { ConfigManager } from '../../config/config.manager.js';
import { PRRegistry } from '../registry/pr.registry.js';
import { SyncJob } from './sync.job.js';
import { SyncOptions, ProgressEvent, RunSummary } from './sync.types.js';
import { Redactor } from '../../utils/redactor.js';
import { Logger } from '../../utils/logger.js';

export class SyncManager {
  private static logsBaseDir = path.resolve(process.cwd(), '.mcp-pr-companion', 'logs');

  static generateRunId(): string {
    const now = new Date();
    const dateStr = now.toISOString().replace(/[-:]/g, '').replace('T', '-').split('.')[0];
    const rand = Math.random().toString(36).substring(2, 6);
    return `${dateStr}-${rand}`;
  }

  static async syncAll(options: SyncOptions = {}): Promise<RunSummary> {
    const urls = PRRegistry.list();
    return this.syncSelected(urls, options);
  }

  static async syncSelected(urls: string[], options: SyncOptions = {}): Promise<RunSummary> {
    const runId = this.generateRunId();
    const config = ConfigManager.loadBase();
    const concurrency = options.concurrency || config.sync.concurrency || 2;
    const limit = pLimit(concurrency);

    const dateFolder = new Date().toISOString().split('T')[0];
    const logDir = path.join(this.logsBaseDir, dateFolder);
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logFile = path.join(logDir, `run-${runId}.jsonl`);
    const summaryFile = path.join(logDir, `run-${runId}-summary.json`);
    const latestSummaryFile = path.join(this.logsBaseDir, 'latest-summary.json');

    const startedAt = new Date().toISOString();
    const summaryItems: RunSummary['items'] = [];

    let succeeded = 0;
    let cached = 0;
    let failed = 0;
    let cancelled = 0;

    const logStream = fs.createWriteStream(logFile, { flags: 'a', encoding: 'utf-8' });

    const handleProgress = (event: ProgressEvent) => {
      // Write to JSON Lines log
      const logLine = JSON.stringify({
        ts: new Date().toISOString(),
        run_id: runId,
        url: event.url,
        pr_key: `${event.workspace}/${event.repoSlug}#${event.prId}`,
        stage: event.stage,
        percent: event.percent,
        message: event.message,
        error: event.error ? Redactor.redact(event.error) : undefined
      }) + '\n';
      logStream.write(logLine);

      if (options.onProgress) {
        options.onProgress(event);
      }
    };

    const tasks = urls.map(url => {
      return limit(async () => {
        if (options.signal?.aborted) {
          cancelled++;
          summaryItems.push({ url, status: 'cancelled', error: 'Cancelled by user' });
          return;
        }

        const job = new SyncJob(runId, url, { ...options, onProgress: handleProgress });
        try {
          const res = await job.execute();
          if (res.status === 'cached') {
            cached++;
          } else {
            succeeded++;
          }
          summaryItems.push({
            url,
            status: res.status,
            ticketId: res.ticketId,
            sourceHash: res.sourceHash
          });
        } catch (err: any) {
          if (options.signal?.aborted) {
            cancelled++;
            summaryItems.push({ url, status: 'cancelled', error: 'Cancelled by user' });
          } else {
            failed++;
            const errMsg = Redactor.redact(err.message || String(err));
            summaryItems.push({ url, status: 'failed', error: errMsg });
          }
        }
      });
    });

    await Promise.all(tasks);
    logStream.end();

    const finishedAt = new Date().toISOString();
    const summary: RunSummary = {
      runId,
      startedAt,
      finishedAt,
      total: urls.length,
      succeeded,
      cached,
      failed,
      cancelled,
      items: summaryItems
    };

    fs.writeFileSync(summaryFile, JSON.stringify(summary, null, 2), 'utf-8');
    fs.writeFileSync(latestSummaryFile, JSON.stringify(summary, null, 2), 'utf-8');

    return summary;
  }

  static getLatestSummary(): RunSummary | null {
    const latestFile = path.join(this.logsBaseDir, 'latest-summary.json');
    if (!fs.existsSync(latestFile)) return null;

    try {
      return JSON.parse(fs.readFileSync(latestFile, 'utf-8'));
    } catch {
      return null;
    }
  }
}
