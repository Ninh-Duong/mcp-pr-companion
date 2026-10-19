import { purgePlaintext } from '../core/storage/purge.js';
import { StorePathResolver } from '../core/output/store-path.resolver.js';
import { ConfigManager } from '../config/config.manager.js';

// `node bin/cli.js purge-plaintext`: one-off cleanup of ai-context data written before encryption.
const root = StorePathResolver.resolveRoot(ConfigManager.loadBase().ai_context.root);
const deleted = purgePlaintext(root);
console.log(`Deleted ${deleted} unencrypted file(s) under ${root}. Re-sync PRs to rebuild them encrypted.`);
