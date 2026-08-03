import { select, input, password, confirm } from '@inquirer/prompts';
import { ConfigManager } from '../config/config.manager.js';
import { SecretStore } from '../config/secret.store.js';

export class ConfigMenu {
  static async show(): Promise<void> {
    let running = true;
    while (running) {
      const choice = await select({
        message: '⚙️  Configuration Menu',
        choices: [
          { name: '1. Edit base settings (Workspace, Language, Concurrency)', value: 'base' },
          { name: '2. Configure Bitbucket Read Token', value: 'read_token' },
          { name: '3. Configure Bitbucket Write Token', value: 'write_token' },
          { name: '4. Test Bitbucket Read Connection', value: 'test_conn' },
          { name: '5. Validate All Configuration', value: 'validate' },
          { name: '6. Cache & Retention Settings', value: 'cache' },
          { name: '7. Back to Main Menu', value: 'back' }
        ]
      });

      switch (choice) {
        case 'base':
          await this.editBaseSettings();
          break;
        case 'read_token':
          await this.configureReadToken();
          break;
        case 'write_token':
          await this.configureWriteToken();
          break;
        case 'test_conn':
          await this.testConnection();
          break;
        case 'validate':
          await this.validateAll();
          break;
        case 'cache':
          await this.editCacheSettings();
          break;
        case 'back':
          running = false;
          break;
      }
    }
  }

  private static async editBaseSettings(): Promise<void> {
    const current = ConfigManager.loadBase();
    const workspace = await input({
      message: 'Bitbucket Workspace slug:',
      default: current.workspace
    });
    const output_language = await select({
      message: 'Output Language for AI Payload:',
      choices: [
        { name: 'Vietnamese (vi)', value: 'vi' as const },
        { name: 'English (en)', value: 'en' as const },
        { name: 'Bilingual (bilingual)', value: 'bilingual' as const }
      ],
      default: current.output_language
    });
    const concurrencyStr = await input({
      message: 'Max Concurrent Sync Jobs:',
      default: String(current.sync.concurrency)
    });

    ConfigManager.saveBase({
      workspace: workspace.trim(),
      output_language,
      sync: {
        ...current.sync,
        concurrency: parseInt(concurrencyStr, 10) || 2
      }
    });

    console.log('✅ Base settings saved successfully!\n');
  }

  private static async configureReadToken(): Promise<void> {
    const summary = SecretStore.getMaskedSummary();
    console.log(`\nCurrent Read Config -> Email: ${summary.email}, Read Token: ${summary.readToken}`);

    const email = await input({
      message: 'Enter Bitbucket Email:',
      default: summary.email !== 'Not configured' ? summary.email : ''
    });

    const readToken = await password({
      message: 'Enter Bitbucket Read API Token (masked input):',
      mask: '*'
    });

    if (email && readToken) {
      SecretStore.saveCredentials({ email: email.trim(), readToken: readToken.trim() });
      console.log('✅ Read token and email updated safely in credentials.env!\n');
    }
  }

  private static async configureWriteToken(): Promise<void> {
    const summary = SecretStore.getMaskedSummary();
    const writeProf = ConfigManager.loadProfile('write');

    console.log(`\nCurrent Write Profile Status: ${writeProf.enabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`Write Token: ${summary.writeToken}`);

    const enableWrite = await confirm({
      message: 'Enable Write Profile capabilities? (Default: false)',
      default: writeProf.enabled
    });

    let writeToken = SecretStore.getCredentials().writeToken;

    if (enableWrite) {
      writeToken = await password({
        message: 'Enter Bitbucket Write API Token:',
        mask: '*'
      });
      if (writeToken) {
        SecretStore.saveCredentials({ writeToken: writeToken.trim() });
      }
    }

    ConfigManager.saveProfile('write', { enabled: enableWrite });
    console.log(`✅ Write Profile updated (Enabled: ${enableWrite}).\n`);
  }

  private static async testConnection(): Promise<void> {
    console.log('\n🔍 Testing Bitbucket Read Connection...');
    const result = await ConfigManager.testConnection('read');
    if (result.success) {
      console.log(`✅ [SUCCESS] ${result.message}\n`);
    } else {
      console.log(`❌ [FAILED] ${result.message}\n`);
    }
  }

  private static async validateAll(): Promise<void> {
    const res = ConfigManager.validate('read');
    if (res.valid) {
      console.log('✅ [VALID] All read configurations and credentials are valid.\n');
    } else {
      console.log('❌ [INVALID] Found configuration issues:');
      res.errors.forEach(e => console.log(`   - ${e}`));
      console.log();
    }
  }

  private static async editCacheSettings(): Promise<void> {
    const current = ConfigManager.loadBase();
    const maxRevisions = await input({
      message: 'Max Revisions to keep per PR:',
      default: String(current.cache.max_revisions_per_pr)
    });
    const retentionDays = await input({
      message: 'Retention Period (Days):',
      default: String(current.cache.retention_days)
    });

    ConfigManager.saveBase({
      cache: {
        ...current.cache,
        max_revisions_per_pr: parseInt(maxRevisions, 10) || 3,
        retention_days: parseInt(retentionDays, 10) || 30
      }
    });

    console.log('✅ Cache & Retention settings updated!\n');
  }
}
