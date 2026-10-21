import { RedactionTracker } from './redaction.report.js';

export class SecretScanner {
  private static patterns: Array<{ category: string; regex: RegExp; replacement: string }> = [
    {
      category: 'private_key',
      regex: /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY( BLOCK)?-----[\s\S]*?-----END (RSA |EC |DSA |OPENSSH |ENCRYPTED |PGP )?PRIVATE KEY( BLOCK)?-----/gi,
      replacement: '[REDACTED:PRIVATE_KEY]'
    },
    {
      // A diff hunk can cut a PEM block: BEGIN with no END (body until the first non-base64 line)…
      category: 'private_key',
      regex: /-----BEGIN [A-Z ]*PRIVATE KEY( BLOCK)?-----(?:\r?\n[+\- ]?[A-Za-z0-9+\/=]+)*/g,
      replacement: '[REDACTED:PRIVATE_KEY]'
    },
    {
      // …or END with no BEGIN (the base64 lines just before it).
      category: 'private_key',
      regex: /(?:^[+\- ]?[A-Za-z0-9+\/=]{40,}\r?\n)+[+\- ]?-----END [A-Z ]*PRIVATE KEY( BLOCK)?-----/gm,
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
      category: 'auth_header',
      regex: /(Authorization:\s*)(?!\[REDACTED)[^\r\n]+/gi,
      replacement: '$1[REDACTED]'
    },
    {
      category: 'json_secret',
      // Any JSON key that names a secret: "client_secret", "access_token", "apiKey", "ConnectionString", …
      regex: /"([\w-]*(?:app_password|token|password|passwd|secret|authorization|api[_-]?key|access[_-]?key|private[_-]?key|connection[_-]?string|credential)[\w-]*)"\s*:\s*"[^"]+"/gi,
      replacement: '"$1": "[REDACTED]"'
    },
    {
      category: 'atlassian_token',
      regex: /\b(?:ATBB|ATATT)[A-Za-z0-9_=-]{10,}/g,
      replacement: '[REDACTED:ATLASSIAN_TOKEN]'
    },
    {
      category: 'provider_token',
      regex: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|sk-(?:proj|ant)-[A-Za-z0-9_-]{20,}|xox[abpr]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|sk_live_[0-9A-Za-z]{16,})/g,
      replacement: '[REDACTED:PROVIDER_TOKEN]'
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
      category: 'azure_key',
      regex: /\b(AccountKey|SharedAccessKey|SharedAccessSignature)=[^;\s"']+/gi,
      replacement: '$1=[REDACTED]'
    },
    {
      category: 'sas_signature',
      regex: /([?&]sig=)[^&\s"']+/gi,
      replacement: '$1[REDACTED]'
    },
    {
      // Base64 values too (+ / =), so a key is never cut in half.
      category: 'api_token',
      regex: /(?:api[_-]?(?:token|key)|app[_-]?password|access[_-]?(?:token|key)|auth[_-]?token|secret[_-]?(?:access[_-]?)?key|client[_-]?secret)["']?\s*[:=]\s*["']?([A-Za-z0-9\-_.~+\/=]{16,})["']?/gi,
      replacement: '[REDACTED:API_TOKEN]'
    },
    {
      category: 'password_assignment',
      regex: /\b(?:password|passwd|pwd|pass)\s*[:=]\s*(?:"[^"\n]{4,}"|'[^'\n]{4,}'|[^"'\s;\n,]{4,})/gi,
      replacement: '[REDACTED:PASSWORD]'
    },
    {
      // Any scheme: https, postgresql, mongodb+srv, redis, amqp, …
      category: 'credential_url',
      regex: /\b[a-z][a-z0-9+.-]*:\/\/[^:\s\/]+:[^@\s]+@[^\s\/]+/gi,
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
