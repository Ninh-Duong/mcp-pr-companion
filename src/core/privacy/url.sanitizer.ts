export class URLSanitizer {
  /**
   * Removes credentials, tokens, and query strings from URLs.
   * Replaces provider links (bitbucket URLs, approve/merge/decline endpoints) with sanitized placeholder.
   */
  static sanitize(url: string | undefined): string {
    if (!url) return '';

    // Strip basic auth credentials embedded in URL: e.g. https://user:pass@domain.com
    let sanitized = url.replace(/https?:\/\/([^:]+):([^@]+)@/gi, 'https://');

    // Remove query parameter credentials
    sanitized = sanitized.replace(/([?&](?:access_token|token|key|secret|password|auth|api_key)=)[^&]*/gi, '$1[REDACTED]');

    // Strip provider endpoints (approve, merge, decline, request-changes, self links)
    if (sanitized.includes('/pull-requests/') && (sanitized.includes('/approve') || sanitized.includes('/merge') || sanitized.includes('/decline'))) {
      return '[REDACTED:PROVIDER_ENDPOINT]';
    }

    return sanitized;
  }
}
