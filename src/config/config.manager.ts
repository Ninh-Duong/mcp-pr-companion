import { BaseConfig, BaseConfigSchema } from './config.schema.js';

export interface EnvCredentials {
  email: string;
  token: string;
  /** "workspace/repo" entries from BITBUCKET_REPOSITORY (comma-separated). */
  repositories: string[];
}

/** Where a value came from: process env, the Hub's "bitbucket" block, the local .env, or nowhere. */
export type ConfigSource = 'env' | 'hub' | 'local' | 'unset';
export interface ConfigSources {
  credentials: ConfigSource;
  workspace: ConfigSource;
  repository: ConfigSource;
  allowed_emails: ConfigSource;
}
const SOURCES: readonly string[] = ['env', 'hub', 'local', 'unset'];

/**
 * All configuration comes from environment variables. bin/cli.js fills unset ones from the Hub's
 * "bitbucket" block (CENTRAL_CONFIG_PATH), then from .env. See .env.example for the full list.
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
   * Source of each value group, from PR_COMPANION_CONFIG_SOURCES (set by bin/cli.js). Names only, never values.
   * credentials = the source of BITBUCKET_API_TOKEN. Without the launcher (e.g. tests), a set value counts as local.
   */
  static sources(): ConfigSources {
    let given: Record<string, unknown> = {};
    try {
      given = JSON.parse(process.env.PR_COMPANION_CONFIG_SOURCES || '{}');
    } catch {
      // Malformed: fall back to local/unset below.
    }
    const of = (key: string): ConfigSource => {
      const value = given?.[key];
      if (typeof value === 'string' && SOURCES.includes(value)) return value as ConfigSource;
      return (process.env[key] || '').trim() ? 'local' : 'unset';
    };
    return {
      credentials: of('BITBUCKET_API_TOKEN'),
      workspace: of('BITBUCKET_WORKSPACE'),
      repository: of('BITBUCKET_REPOSITORY'),
      allowed_emails: of('ALLOWED_EMAILS')
    };
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
