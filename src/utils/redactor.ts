/**
 * Redactor utility for sensitive data (tokens, authorization headers, passwords).
 */
export class Redactor {
  // Regex to match Authorization headers (Bearer, Basic, ATBB tokens, etc.)
  private static readonly AUTH_HEADER_REGEX = /(Authorization:\s*)([^\r\n]+)/gi;
  // Regex to match raw Bearer/Basic tokens
  private static readonly TOKEN_REGEX = /(ATBB[A-Za-z0-9_-]{10,})/gi;
  // Regex to match email addresses if needed, or password/token fields in JSON
  private static readonly JSON_SECRET_REGEX = /"(app_password|token|password|secret|authorization)"\s*:\s*"([^"]+)"/gi;

  /**
   * Masks a string token into ATBB****abcd format.
   */
  static maskToken(token: string): string {
    if (!token) return '';
    const trimmed = token.trim();
    if (trimmed.length <= 8) {
      return '****';
    }
    const prefix = trimmed.substring(0, 4);
    const suffix = trimmed.substring(trimmed.length - 4);
    return `${prefix}****${suffix}`;
  }

  /**
   * Redacts sensitive strings (tokens, authorization headers, passwords) from arbitrary log text or objects.
   */
  static redact(input: unknown): string {
    if (input === null || input === undefined) return '';

    let text: string;
    if (typeof input === 'object') {
      try {
        text = JSON.stringify(input, null, 2);
      } catch {
        text = String(input);
      }
    } else {
      text = String(input);
    }

    // 1. Redact json keys like "token": "...", "app_password": "..."
    text = text.replace(this.JSON_SECRET_REGEX, (match, key) => `"${key}": "[REDACTED]"`);

    // 2. Redact Authorization header values
    text = text.replace(this.AUTH_HEADER_REGEX, '$1[REDACTED]');

    // 3. Redact explicit Bitbucket tokens matching ATBB pattern
    text = text.replace(this.TOKEN_REGEX, (match) => this.maskToken(match));

    return text;
  }
}
