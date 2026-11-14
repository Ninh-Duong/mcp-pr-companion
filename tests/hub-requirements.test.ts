// mcp-hub reads hub-requirements.json to warn when these Bitbucket values are empty in the Hub file.
// This checks that every key it names is a field the launcher (bin/cli.js HUB_KEYS) reads from the hub block.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const requirements = JSON.parse(readFileSync(path.join(root, 'hub-requirements.json'), 'utf8'));
const launcher = readFileSync(path.join(root, 'bin', 'cli.js'), 'utf8');

assert.equal(requirements.version, 1);
for (const group of requirements.groups) {
  for (const alternative of group.anyOf) {
    for (const key of alternative) {
      const [section, field] = key.split('.');
      assert.equal(section, 'bitbucket', `${key} must sit in the bitbucket block`);
      assert.match(launcher, new RegExp(String.raw`\b${field}: '[A-Z_]+'`), `bin/cli.js does not read ${field} from the hub block`);
    }
  }
}
console.log('✓ hub-requirements.json names only Bitbucket fields the launcher reads');
