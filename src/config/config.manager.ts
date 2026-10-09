import fs from 'fs';
import path from 'path';
import { BaseConfig, BaseConfigSchema } from './config.schema.js';
import { Logger } from '../utils/logger.js';

export class ConfigManager {
  private static baseFile = path.resolve(process.cwd(), '.mcp-pr-companion', 'config', 'base.json');
  private static cached: BaseConfig | null = null;

  static loadBase(): BaseConfig {
    if (this.cached) return this.cached;

    let rawData: unknown = {};
    if (fs.existsSync(this.baseFile)) {
      try {
        rawData = JSON.parse(fs.readFileSync(this.baseFile, 'utf-8'));
      } catch {
        Logger.warn(`Failed to parse ${this.baseFile}, using default BaseConfig.`);
      }
    }

    this.cached = BaseConfigSchema.parse(rawData);
    return this.cached;
  }
}
