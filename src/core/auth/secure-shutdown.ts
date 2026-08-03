import { runtimeSession } from './runtime-session.js';
import { LogRedactor } from '../logging/log.redactor.js';

export class SecureShutdown {
  private static registered = false;

  static registerSignalHandlers(): void {
    if (this.registered) return;
    this.registered = true;

    process.on('SIGINT', () => {
      this.executeShutdown('SIGINT', 0);
    });

    process.on('SIGTERM', () => {
      this.executeShutdown('SIGTERM', 0);
    });

    process.on('uncaughtException', (error: Error) => {
      const redactedMsg = LogRedactor.redactString(error.stack || error.message);
      console.error('\n[Fatal Error]:', redactedMsg);
      this.executeShutdown('uncaughtException', 1);
    });

    process.on('unhandledRejection', (reason: any) => {
      const msg = reason instanceof Error ? reason.stack || reason.message : String(reason);
      const redactedMsg = LogRedactor.redactString(msg);
      console.error('\n[Unhandled Rejection]:', redactedMsg);
      this.executeShutdown('unhandledRejection', 1);
    });
  }

  static executeShutdown(reason: string, exitCode = 0): void {
    try {
      // Clear in-memory credentials immediately
      runtimeSession.clear();
    } catch {
      // Ignore
    } finally {
      process.exit(exitCode);
    }
  }
}
