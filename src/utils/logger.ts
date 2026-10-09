import { Redactor } from './redactor.js';
import { SecretScanner } from '../core/privacy/secret.scanner.js';

/**
 * Logger utility writing strictly to stderr with secret sanitization.
 * Standard Output (stdout) is reserved for MCP JSON-RPC protocol messages.
 */
export class Logger {
  private static sanitize(msg: unknown): string {
    if (msg === null || msg === undefined || msg === '') return '';
    const text = msg instanceof Error ? (msg.stack || msg.message) : msg;
    return SecretScanner.scanAndRedact(Redactor.redact(text));
  }

  private static write(level: string, message: string, args: unknown[]): void {
    console.error(`[${level}] ${new Date().toISOString()} - ${this.sanitize(message)}`, ...args.map(a => this.sanitize(a)));
  }

  static info(message: string, ...args: any[]): void {
    this.write('INFO', message, args);
  }

  static warn(message: string, ...args: any[]): void {
    this.write('WARN', message, args);
  }

  static error(message: string, ...args: any[]): void {
    this.write('ERROR', message, args);
  }

  static debug(message: string, ...args: any[]): void {
    if (process.env.DEBUG === 'true') {
      this.write('DEBUG', message, args);
    }
  }
}
