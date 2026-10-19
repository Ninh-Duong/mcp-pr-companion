import { BaseConfig, BaseConfigSchema } from './config.schema.js';

export interface EnvCredentials {
  email: string;
  token: string;
  /** "workspace/repo" entries from BITBUCKET_REPOSITORY (comma-separated). */
  repositories: string[];
}

/**
 * All configuration comes from environment variables (loaded from .env by bin/cli.js).
 * See .env.example for the full list.
 */
export class ConfigManager {
  private static cached: BaseConfig | null = null;

  static loadBase(): BaseConfig {
    if (this.cached) return this.cached;
    const env = process.env;
    this.cached = BaseConfigSchema.parse({
      ticket_prefix: env.TICKET_PREFIXES,
      allowed_emails: env.ALLOWED_EMAILS,
      auto_sync_on_start: env.AUTO_SYNC_ON_START,
      privacy: {
        mode: env.PRIVACY_MODE,
        remove_author: env.PRIVACY_REMOVE_AUTHOR,
        file_path_mode: env.PRIVACY_FILE_PATH_MODE,
        max_commit_subjects: env.PRIVACY_MAX_COMMIT_SUBJECTS
      },
      ai_context: {
        root: env.AI_CONTEXT_ROOT,
        company: env.AI_CONTEXT_COMPANY
      }
    });
    return this.cached;
  }

  /**
   * BITBUCKET_REPOSITORY accepts a comma-separated list. Entries without a "/" are
   * prefixed with BITBUCKET_WORKSPACE, e.g. WORKSPACE=acme + "demo.api,demo.db".
   */
  static credentials(): EnvCredentials {
    const env = process.env;
    const workspace = (env.BITBUCKET_WORKSPACE || '').trim();
    const repositories = (env.BITBUCKET_REPOSITORY || '')
      .split(',')
      .map(r => r.trim())
      .filter(Boolean)
      .map(r => (r.includes('/') || !workspace ? r : `${workspace}/${r}`));
    return {
      email: (env.BITBUCKET_EMAIL || '').trim(),
      token: (env.BITBUCKET_API_TOKEN || '').trim(),
      repositories: [...new Set(repositories)]
    };
  }
}
