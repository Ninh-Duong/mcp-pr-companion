import fs from 'fs';
import path from 'path';
import { LogRedactor } from './log.redactor.js';
import { OpaqueIDGenerator } from '../storage/opaque.id.js';

export interface GenerationSummaryData {
  timestamp: string;
  run_id: string;
  repository_id: string;
  total_prs: number;
  completed: number;
  cached: number;
  failed: number;
  pr_results: Array<{
    pr_id: number;
    status: 'completed' | 'cached' | 'failed';
    error_code?: string;
  }>;
}

export class RunSummaryWriter {
  static writeSummary(
    workspace: string,
    repoSlug: string,
    runId: string,
    summaryData: Omit<GenerationSummaryData, 'timestamp' | 'run_id' | 'repository_id'>
  ): void {
    const dateStr = new Date().toISOString().split('T')[0];
    const logDir = path.resolve(process.cwd(), 'Logs', dateStr);
    const rootLogDir = path.resolve(process.cwd(), 'Logs');

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const repositoryId = OpaqueIDGenerator.getRepositoryID(workspace, repoSlug);
    const compactTime = new Date().toISOString().replace(/[-:T.]/g, '').substring(0, 14);

    const fullSummary: GenerationSummaryData = {
      timestamp: new Date().toISOString(),
      run_id: runId,
      repository_id: repositoryId,
      ...summaryData
    };

    const redactedSummary = LogRedactor.redactObject(fullSummary, workspace, repoSlug);
    const summaryJson = JSON.stringify(redactedSummary, null, 2);

    const summaryFilePath = path.join(logDir, `generate-run-${compactTime}-summary.json`);
    const latestSummaryFilePath = path.join(rootLogDir, `latest-summary.json`);

    try {
      fs.writeFileSync(summaryFilePath, summaryJson, 'utf-8');
      fs.writeFileSync(latestSummaryFilePath, summaryJson, 'utf-8');
    } catch {
      // Ignore file writing failure
    }
  }
}
