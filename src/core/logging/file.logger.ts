import fs from 'fs';
import path from 'path';
import { LogRedactor } from './log.redactor.js';

export interface LogEntry {
  timestamp?: string;
  run_id?: string;
  stage: string;
  status: 'success' | 'failed' | 'in_progress' | 'warning';
  error_code?: string;
  http_status?: number;
  message?: string;
  [key: string]: any;
}

export class FileLogger {
  private logDir: string;
  private logFilePath: string;
  private runId: string;
  private workspace?: string;
  private repoSlug?: string;

  constructor(prefix: 'auth' | 'generate', workspace?: string, repoSlug?: string) {
    this.workspace = workspace;
    this.repoSlug = repoSlug;
    const dateStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const timeStr = new Date().toISOString().replace(/[:.]/g, '-').substring(11, 19);
    const compactTime = new Date().toISOString().replace(/[-:T.]/g, '').substring(0, 14);

    this.runId = `run_${Math.random().toString(36).substring(2, 8)}`;
    this.logDir = path.resolve(process.cwd(), 'Logs', dateStr);

    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }

    const filename = `${prefix}-run-${compactTime}.jsonl`;
    this.logFilePath = path.join(this.logDir, filename);
  }

  public getLogFilePath(): string {
    return path.relative(process.cwd(), this.logFilePath);
  }

  public getRunId(): string {
    return this.runId;
  }

  public log(entry: LogEntry): void {
    const fullEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      run_id: this.runId,
      ...entry
    };

    const redactedEntry = LogRedactor.redactObject(fullEntry, this.workspace, this.repoSlug);
    const jsonLine = JSON.stringify(redactedEntry) + '\n';

    try {
      fs.appendFileSync(this.logFilePath, jsonLine, 'utf-8');
    } catch {
      // Ignore logging write failures to prevent breaking CLI execution
    }
  }
}
