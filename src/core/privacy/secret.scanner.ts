import { RedactionTracker } from './redaction.report.js';

export class SecretScanner {
  private static patterns: Array<{ category: string; regex: RegExp; replacement: string }> = [
    {
      category: 'private_key',
      regex: /-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/gi,
      replacement: '[REDACTED:PRIVATE_KEY]'
    },
    {
      category: 'bearer_token',
      regex: /Authorization:\s*Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/gi,
      replacement: '[REDACTED:BEARER_TOKEN]'
    },
    {
      category: 'basic_auth',
      regex: /Authorization:\s*Basic\s+[A-Za-z0-9+\/]+=*/gi,
      replacement: '[REDACTED:BASIC_AUTH]'
    },
    {
      category: 'aws_key',
      regex: /\b(AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b/g,
      replacement: '[REDACTED:AWS_KEY]'
    },
    {
      category: 'jwt',
      regex: /\beyJ[A-Za-z0-9_-]{10,}\.ey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      replacement: '[REDACTED:JWT]'
    },
    {
      category: 'connection_string',
      regex: /(Server|Data Source|Host)=[^;]+;(Database|Initial Catalog)=[^;]+;(User Id|UID)=[^;]+;(Password|PWD)=[^;]+/gi,
      replacement: '[REDACTED:CONNECTION_STRING]'
    },
    {
      category: 'api_token',
      regex: /(?:api[_-]?token|app[_-]?password|access[_-]?token|auth[_-]?token|secret[_-]?key)\s*[:=]\s*["']?([A-Za-z0-9\-_.~]{16,})["']?/gi,
      replacement: '[REDACTED:API_TOKEN]'
    },
    {
      category: 'password_assignment',
      regex: /(?:password|pwd|pass)\s*[:=]\s*["']?([^"'\s;\n,]{4,})["']?/gi,
      replacement: '[REDACTED:PASSWORD]'
    },
    {
      category: 'credential_url',
      regex: /https?:\/\/[^:\s]+:[^@\s]+@[^\s\/]+/gi,
      replacement: '[REDACTED:CREDENTIAL_URL]'
    }
  ];

  /**
   * Scans text content for sensitive credentials and replaces them with redacted placeholders.
   */
  static scanAndRedact(content: string, tracker?: RedactionTracker): string {
    if (!content) return '';

    let sanitized = content;

    for (const item of this.patterns) {
      const matches = sanitized.match(item.regex);
      if (matches && matches.length > 0) {
        if (tracker) {
          tracker.recordRedaction(item.category, matches.length);
        }
        sanitized = sanitized.replace(item.regex, item.replacement);
      }
    }

    return sanitized;
  }
}
