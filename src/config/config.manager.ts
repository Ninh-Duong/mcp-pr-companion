import { BaseConfig, BaseConfigSchema } from './config.schema.js';

export interface EnvCredentials {
  email: string;
  token: string;
  repository: string;
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
      privacy: {
        mode: env.PRIVACY_MODE,
        remove_author: env.PRIVACY_REMOVE_AUTHOR,
        file_path_mode: env.PRIVACY_FILE_PATH_MODE,
        max_commit_subjects: env.PRIVACY_MAX_COMMIT_SUBJECTS
      },
      ai_context: {
        root: env.AI_CONTEXT_ROOT,
        company: env.AI_CONTEXT_COMPANY,
        app: env.AI_CONTEXT_APP
      }
    });
    return this.cached;
  }

  static credentials(): EnvCredentials {
    const env = process.env;
    return {
      email: (env.BITBUCKET_EMAIL || '').trim(),
      token: (env.BITBUCKET_API_TOKEN || '').trim(),
      repository: (env.BITBUCKET_REPOSITORY || '').trim()
    };
  }
}
