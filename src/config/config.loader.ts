import { ConfigManager } from './config.manager.js';
import { Config } from './config.schema.js';

export class ConfigLoader {
  static load(): Config {
    const base = ConfigManager.loadBase();
    return base as Config;
  }

  static clearCache(): void {
    ConfigManager.clearCache();
  }
}
