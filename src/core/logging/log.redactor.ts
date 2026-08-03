import { OpaqueIDGenerator } from '../storage/opaque.id.js';

export class LogRedactor {
  private static emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  private static uuidRegex = /\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?/g;
  private static bearerRegex = /Bearer\s+[A-Za-z0-9\-\._~\+\/]+=*/gi;
  private static basicAuthRegex = /Basic\s+[A-Za-z0-9\+\/]+=*/gi;
  private static bitbucketTokenRegex = /ATBB[a-zA-Z0-9_\-]+/g;

  static redactString(text: string, workspace?: string, repoSlug?: string): string {
    if (!text) return text;
    let redacted = text;

    // Redact tokens & auth headers
    redacted = redacted.replace(this.bearerRegex, 'Bearer [REDACTED_TOKEN]');
    redacted = redacted.replace(this.basicAuthRegex, 'Basic [REDACTED_BASIC_AUTH]');
    redacted = redacted.replace(this.bitbucketTokenRegex, '[REDACTED_TOKEN]');

    // Redact emails & UUIDs
    redacted = redacted.replace(this.emailRegex, '[REDACTED_EMAIL]');
    redacted = redacted.replace(this.uuidRegex, '[REDACTED_UUID]');

    // Replace workspace/repo if provided
    if (workspace && repoSlug) {
      const opaqueId = OpaqueIDGenerator.getRepositoryID(workspace, repoSlug);
      const targetPattern = new RegExp(`${workspace}\\/${repoSlug}`, 'gi');
      redacted = redacted.replace(targetPattern, opaqueId);
    }

    return redacted;
  }

  static redactObject<T>(obj: T, workspace?: string, repoSlug?: string): T {
    if (obj === null || obj === undefined) return obj;

    if (typeof obj === 'string') {
      return this.redactString(obj, workspace, repoSlug) as any;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.redactObject(item, workspace, repoSlug)) as any;
    }

    if (typeof obj === 'object') {
      const result: Record<string, any> = {};
      for (const [key, value] of Object.entries(obj)) {
        const lowerKey = key.toLowerCase();

        // Drop forbidden keys entirely or redact
        if (
          lowerKey.includes('token') ||
          lowerKey.includes('authorization') ||
          lowerKey.includes('password') ||
          lowerKey.includes('secret')
        ) {
          result[key] = '[REDACTED]';
        } else if (lowerKey.includes('email') || lowerKey.includes('uuid') || lowerKey.includes('author')) {
          result[key] = '[REDACTED]';
        } else {
          result[key] = this.redactObject(value, workspace, repoSlug);
        }
      }
      return result as T;
    }

    return obj;
  }
}
