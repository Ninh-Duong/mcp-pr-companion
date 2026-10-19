import fs from 'fs';
import path from 'path';
import { SecretScanner } from '../core/privacy/secret.scanner.js';

/**
 * Secret-redacting logger. Writes to stderr AND appends to Logs/mcp-server.log, because mcp-hub
 * discards a child's stderr. Never writes to stdout: stdout carries the MCP JSON-RPC stream.
 * Past MAX_LOG_BYTES the file moves to mcp-server.log.1 (one backup kept).
 */
export class Logger {
  static readonly MAX_LOG_BYTES = 5 * 1024 * 1024;
  private static file: string | null = null;

  private static sanitize(msg: unknown): string {
    if (msg === null || msg === undefined || msg === '') return '';
    const text = msg instanceof Error ? (msg.stack || msg.message) : typeof msg === 'object' ? JSON.stringify(msg) : String(msg);
    return SecretScanner.scanAndRedact(text);
  }

  private static write(level: string, message: string, args: unknown[]): void {
    const line = [`[${level}] ${new Date().toISOString()} - ${this.sanitize(message)}`, ...args.map(a => this.sanitize(a))].join(' ');
    process.stderr.write(line + '\n');
    try {
      if (!this.file) {
        // Resolved on first write: the launcher (bin/cli.js) runs every entry point with cwd = project root.
        this.file = path.resolve('Logs', 'mcp-server.log');
        fs.mkdirSync(path.dirname(this.file), { recursive: true });
      }
      if (fs.existsSync(this.file) && fs.statSync(this.file).size > this.MAX_LOG_BYTES) {
        fs.renameSync(this.file, `${this.file}.1`);
      }
      fs.appendFileSync(this.file, line + '\n', 'utf-8');
    } catch {
      // Logging must never break a tool call.
    }
  }

  static info(message: string, ...args: unknown[]): void {
    this.write('INFO', message, args);
  }

  static warn(message: string, ...args: unknown[]): void {
    this.write('WARN', message, args);
  }

  static error(message: string, ...args: unknown[]): void {
    this.write('ERROR', message, args);
  }

  static debug(message: string, ...args: unknown[]): void {
    if (process.env.DEBUG === 'true') {
      this.write('DEBUG', message, args);
    }
  }
}
