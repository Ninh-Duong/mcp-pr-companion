import { Redactor } from './redactor.js';
import { SecretScanner } from '../core/privacy/secret.scanner.js';

/**
 * Logger utility writing strictly to stderr with secret sanitization.
 * Standard Output (stdout) is reserved for MCP JSON-RPC protocol messages.
 */
export class Logger {
  private static sanitize(msg: string): string {
    if (!msg) return '';
    return SecretScanner.scanAndRedact(Redactor.redact(msg));
  }

  static info(message: string, ...args: any[]): void {
    console.error(`[INFO] ${new Date().toISOString()} - ${this.sanitize(message)}`, ...args);
  }

  static warn(message: string, ...args: any[]): void {
    console.error(`[WARN] ${new Date().toISOString()} - ${this.sanitize(message)}`, ...args);
  }

  static error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${new Date().toISOString()} - ${this.sanitize(message)}`, ...args);
  }

  static debug(message: string, ...args: any[]): void {
    if (process.env.DEBUG === 'true') {
      console.error(`[DEBUG] ${new Date().toISOString()} - ${this.sanitize(message)}`, ...args);
    }
  }
}
