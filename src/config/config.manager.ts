import fs from 'fs';
import path from 'path';
import { BaseConfig, BaseConfigSchema, ReadProfile, ReadProfileSchema, WriteProfile, WriteProfileSchema, LegacyConfigSchema } from './config.schema.js';
import { SecretStore } from './secret.store.js';
import { Logger } from '../utils/logger.js';

export class ConfigManager {
  private static runtimeDir = path.resolve(process.cwd(), '.mcp-pr-companion');
  private static configDir = path.join(ConfigManager.runtimeDir, 'config');

  private static baseFile = path.join(ConfigManager.configDir, 'base.json');
  private static readFile = path.join(ConfigManager.configDir, 'read.json');
  private static writeFile = path.join(ConfigManager.configDir, 'write.json');
  private static legacyFile = path.resolve(process.cwd(), 'config.json');

  private static profileCache = new Map<string, any>();

  static ensureDirs(): void {
    if (!fs.existsSync(this.configDir)) {
      fs.mkdirSync(this.configDir, { recursive: true });
    }
  }

  /**
   * Checks if legacy config.json exists with app_password and logs a migration warning.
   */
  static checkLegacyMigration(): { hasLegacy: boolean; warning?: string } {
    if (fs.existsSync(this.legacyFile)) {
      try {
        const raw = fs.readFileSync(this.legacyFile, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed.bitbucket?.app_password) {
          const warning = '⚠️ [SECURITY WARNING] Legacy config.json detected with app_password. Bitbucket Cloud now requires scoped API Tokens. Please migrate your credentials to npm run cmd -> Configuration menu.';
          return { hasLegacy: true, warning };
        }
      } catch {
        // Ignore parse error
      }
    }
    return { hasLegacy: false };
  }

  static loadBase(): BaseConfig {
    if (this.profileCache.has('base')) {
      return this.profileCache.get('base');
    }

    this.ensureDirs();

    let rawData: any = {};
    if (fs.existsSync(this.baseFile)) {
      try {
        rawData = JSON.parse(fs.readFileSync(this.baseFile, 'utf-8'));
      } catch (err) {
        Logger.warn(`Failed to parse ${this.baseFile}, using default BaseConfig.`);
      }
    } else if (fs.existsSync(this.legacyFile)) {
      // Fallback: merge values from legacy config.json if base.json doesn't exist yet
      try {
        const legacy = JSON.parse(fs.readFileSync(this.legacyFile, 'utf-8'));
        if (legacy.bitbucket?.workspace) rawData.workspace = legacy.bitbucket.workspace;
        if (legacy.ticket_prefix) rawData.ticket_prefix = legacy.ticket_prefix;
        if (legacy.output_language) rawData.output_language = legacy.output_language;
        if (legacy.default_target_branch) rawData.default_target_branch = legacy.default_target_branch;
        if (legacy.default_pr_url || legacy.bitbucket?.default_pr_url) rawData.default_pr_url = legacy.default_pr_url || legacy.bitbucket?.default_pr_url;
        if (legacy.module_rules) rawData.module_rules = legacy.module_rules;
      } catch {
        // Ignore fallback parse error
      }
    }

    const baseConfig = BaseConfigSchema.parse(rawData);
    this.profileCache.set('base', baseConfig);
    return baseConfig;
  }

  static saveBase(config: Partial<BaseConfig>): BaseConfig {
    this.ensureDirs();
    const current = this.loadBase();
    const merged = BaseConfigSchema.parse({ ...current, ...config });
    fs.writeFileSync(this.baseFile, JSON.stringify(merged, null, 2), 'utf-8');
    this.profileCache.set('base', merged);
    return merged;
  }

  static loadProfile(profile: 'read'): ReadProfile;
  static loadProfile(profile: 'write'): WriteProfile;
  static loadProfile(profile: 'read' | 'write'): ReadProfile | WriteProfile {
    if (this.profileCache.has(profile)) {
      return this.profileCache.get(profile);
    }

    this.ensureDirs();
    const targetFile = profile === 'read' ? this.readFile : this.writeFile;

    let rawData: any = {};
    if (fs.existsSync(targetFile)) {
      try {
        rawData = JSON.parse(fs.readFileSync(targetFile, 'utf-8'));
      } catch (err) {
        Logger.warn(`Failed to parse ${targetFile}, using default ${profile} profile.`);
      }
    }

    const parsed = profile === 'read' ? ReadProfileSchema.parse(rawData) : WriteProfileSchema.parse(rawData);
    this.profileCache.set(profile, parsed);
    return parsed;
  }

  static saveProfile(profile: 'read', data: Partial<ReadProfile>): ReadProfile;
  static saveProfile(profile: 'write', data: Partial<WriteProfile>): WriteProfile;
  static saveProfile(profile: 'read' | 'write', data: any): any {
    this.ensureDirs();
    const targetFile = profile === 'read' ? this.readFile : this.writeFile;
    const current = profile === 'read' ? this.loadProfile('read') : this.loadProfile('write');
    const schema = profile === 'read' ? ReadProfileSchema : WriteProfileSchema;
    const merged = schema.parse({ ...current, ...data });

    fs.writeFileSync(targetFile, JSON.stringify(merged, null, 2), 'utf-8');
    this.profileCache.set(profile, merged);
    return merged;
  }

  static resolve(profile: 'read' | 'write') {
    const base = this.loadBase();
    const prof = profile === 'read' ? this.loadProfile('read') : this.loadProfile('write');
    const creds = SecretStore.getCredentials();

    const token = profile === 'read' ? creds.readToken : creds.writeToken;

    return {
      base,
      profile: prof,
      email: creds.email,
      token
    };
  }

  static validate(profile: 'read' | 'write'): { valid: boolean; errors: string[] } {
    const errors: string[] = [];
    const base = this.loadBase();
    const creds = SecretStore.getCredentials();

    if (!creds.email || !creds.email.includes('@')) {
      errors.push('Bitbucket email is missing or invalid.');
    }

    const token = profile === 'read' ? creds.readToken : creds.writeToken;

    if (profile === 'read') {
      if (!token) {
        errors.push('Bitbucket read API token (BITBUCKET_READ_TOKEN) is missing.');
      }
    } else if (profile === 'write') {
      const writeProf = this.loadProfile('write');
      if (writeProf.enabled && !token) {
        errors.push('Write profile is enabled but BITBUCKET_WRITE_TOKEN is missing.');
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Tests read connection to Bitbucket API using GET request (never writes).
   */
  static async testConnection(profile: 'read' = 'read'): Promise<{ success: boolean; message: string }> {
    const validation = this.validate(profile);
    if (!validation.valid) {
      return { success: false, message: validation.errors.join(' ') };
    }

    const { base, email, token } = this.resolve(profile);
    if (!token || !email) {
      return { success: false, message: 'Missing credentials for test connection.' };
    }

    const authHeader = 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
    const url = base.workspace
      ? `https://api.bitbucket.org/2.0/repositories/${base.workspace}`
      : 'https://api.bitbucket.org/2.0/user';

    try {
      const res = await fetch(url, {
        headers: {
          'Authorization': authHeader,
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        return { success: true, message: `Successfully authenticated with Bitbucket API (${res.status} OK).` };
      } else {
        const text = await res.text();
        return { success: false, message: `Bitbucket API returned status ${res.status}: ${res.statusText}` };
      }
    } catch (err: any) {
      return { success: false, message: `Network error connecting to Bitbucket: ${err.message || String(err)}` };
    }
  }

  static clearCache(): void {
    this.profileCache.clear();
  }
}
