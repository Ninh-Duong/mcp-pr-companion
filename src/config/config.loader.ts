import fs from 'fs';
import path from 'path';
import { Config, ConfigSchema } from './config.schema.js';
import { Logger } from '../utils/logger.js';

export class ConfigLoader {
  private static cachedConfig: Config | null = null;

  static load(configPath?: string): Config {
    if (this.cachedConfig) {
      return this.cachedConfig;
    }

    const resolvedPath = configPath || path.resolve(process.cwd(), 'config.json');
    Logger.info(`Loading configuration from: ${resolvedPath}`);

    if (!fs.existsSync(resolvedPath)) {
      Logger.warn(`Configuration file not found at ${resolvedPath}. Falling back to default settings.`);
      this.cachedConfig = ConfigSchema.parse({});
      return this.cachedConfig;
    }

    try {
      const rawData = fs.readFileSync(resolvedPath, 'utf-8');
      const json = JSON.parse(rawData);
      this.cachedConfig = ConfigSchema.parse(json);
      return this.cachedConfig;
    } catch (err) {
      Logger.error(`Failed to parse config file at ${resolvedPath}. Using fallback config.`, err);
      this.cachedConfig = ConfigSchema.parse({});
      return this.cachedConfig;
    }
  }

  static clearCache(): void {
    this.cachedConfig = null;
  }
}
