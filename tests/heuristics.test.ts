// Ticket detection and risk tags on realistic inputs (regressions from real PRs).
import assert from 'node:assert/strict';
import { GitParser } from '../src/core/git/git.parser.ts';
import { RiskAnalyzer } from '../src/core/analyzer/risk.analyzer.ts';
import { ChangeClassifier } from '../src/core/analyzer/change.classifier.ts';
import { BitbucketAllowlistProjector } from '../src/core/bitbucket/bitbucket.allowlist.ts';

const PREFIXES = ['WCE-', 'PROJ-', 'JIRA-'];

// Ticket: a real PR had "[WC-36]" in title and branch but reported N/A (prefix not configured).
assert.equal(GitParser.extractTicketId('feature/Eagers-BE/WC-36-staging', [], PREFIXES, '[Eagers] [WC-36]: Handle SMS replies'), 'WC-36');
assert.equal(GitParser.extractTicketId('main', [], PREFIXES, 'ABC-7: fix login'), 'ABC-7');
assert.equal(GitParser.extractTicketId('feature/x', ['WCE-815: add comment'], PREFIXES, 'Add comment'), 'WCE-815', 'configured prefixes still win, commits included');
assert.equal(GitParser.extractTicketId('feature/x', ['Switch encoding to UTF-8', 'Use SHA-256'], PREFIXES, 'Encoding fix'), 'N/A', 'no generic match in commits');
console.log('  ✓ ticket id from branch segment / title, never UTF-8 from commits');

// Risk: ordinary code that merely mentions token/hash must not be auth_security.
const risk = (path: string, added: string[]) => {
  const diff = {
    oldPath: path, newPath: path, status: 'modified' as const, isBinary: false, additions: added.length, deletions: 0, headerLines: [],
    hunks: [{ header: '@@', oldStart: 1, oldLines: 0, newStart: 1, newLines: added.length, lines: added.map(content => ({ type: 'add' as const, content })) }]
  };
  return RiskAnalyzer.analyze(diff, ChangeClassifier.classify(diff));
};
assert.deepEqual(risk('src/Services/OrderService.cs', ['await repo.SaveAsync(order, cancellationToken);', 'return id.GetHashCode();']).tags, []);
assert.ok(risk('src/Controllers/OrderController.cs', ['[Authorize(Roles = "Admin")]']).tags.includes('auth_security'));
assert.ok(risk('src/Auth/JwtIssuer.cs', ['var x = 1;']).tags.includes('auth_security'), 'auth path still counts');
assert.ok(!risk('src/Authors/AuthorService.cs', ['var x = 1;']).tags.includes('auth_security'), '"Author" is not auth');
assert.ok(risk('src/Startup.cs', ['services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme);']).tags.includes('auth_security'));
assert.ok(!risk('src/Services/UserService.cs', ['var password = input.Password;']).tags.includes('secret_config'), 'secret words in code are not config');
assert.ok(risk('src/appsettings.Development.json', ['"ConnectionString": "x"']).tags.includes('secret_config'));
console.log('  ✓ risk tags need strong signals (no cancellationToken / GetHashCode false positives)');

// Description: long text is capped with a visible marker, short text is untouched.
assert.equal(BitbucketAllowlistProjector.truncateDescription('short'), 'short');
const long = BitbucketAllowlistProjector.truncateDescription('x'.repeat(5000));
assert.ok(long.length < 4100 && long.endsWith('_[description truncated: 4000 of 5000 chars]_'));
console.log('  ✓ description truncation is announced');
