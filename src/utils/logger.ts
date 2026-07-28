/**
 * Logger utility writing strictly to stderr.
 * Standard Output (stdout) is reserved for MCP JSON-RPC protocol messages.
 */
export class Logger {
  static info(message: string, ...args: any[]): void {
    console.error(`[INFO] ${new Date().toISOString()} - ${message}`, ...args);
  }

  static warn(message: string, ...args: any[]): void {
    console.error(`[WARN] ${new Date().toISOString()} - ${message}`, ...args);
  }

  static error(message: string, ...args: any[]): void {
    console.error(`[ERROR] ${new Date().toISOString()} - ${message}`, ...args);
  }

  static debug(message: string, ...args: any[]): void {
    if (process.env.DEBUG === 'true') {
      console.error(`[DEBUG] ${new Date().toISOString()} - ${message}`, ...args);
    }
  }
}
