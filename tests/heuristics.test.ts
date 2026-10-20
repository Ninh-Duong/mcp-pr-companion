// Ticket detection and risk tags on realistic inputs (regressions from real PRs).
import assert from 'node:assert/strict';
import { GitParser } from '../src/core/git/git.parser.ts';
import { RiskAnalyzer } from '../src/core/analyzer/risk.analyzer.ts';
import { ChangeClassifier } from '../src/core/analyzer/change.classifier.ts';
import { BitbucketAllowlistProjector } from '../src/core/bitbucket/bitbucket.allowlist.ts';
import { ContextModeClassifier } from '../src/core/analyzer/context-mode.classifier.ts';
import { TextNormalizer } from '../src/utils/text.normalizer.ts';
import { SymbolExtractor } from '../src/core/analyzer/symbol.extractor.ts';

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

// Project files: a real PR's one-line .csproj edit was tagged secret_config and became the first file to read.
assert.deepEqual(risk('src/App/App.csproj', ['<TargetFramework>net8.0</TargetFramework>']).tags, []);
const pkg = risk('src/App/App.csproj', ['<PackageReference Include="CsvHelper" Version="33.0.1" />']);
assert.deepEqual([pkg.tags, pkg.level], [['dependency'], 'low']);
console.log('  ✓ .csproj edits are dependency or plain configuration, never secret_config');

// SQL: an index on a large table was risk "none" in a real database PR.
const idx = risk('Codes/Db/Indexes/IX_AuditLog_DocKey.sql', ['CREATE NONCLUSTERED INDEX [IX_AuditLog_DocKey]', 'ON [dbo].[AuditLog] ([DocKey])']);
assert.deepEqual([idx.tags, idx.level], [['database_schema'], 'high']);
assert.ok(risk('Codes/Db/Tables/Order.sql', ['ALTER TABLE [dbo].[Order] ADD CONSTRAINT [FK_x] FOREIGN KEY (A) REFERENCES B(Id)']).tags.includes('database_schema'));
const view = risk('Codes/Db/Views/VehicleV.sql', ['CREATE OR ALTER VIEW [dbo].[VehicleV] AS', 'SELECT 1 AS X']);
assert.deepEqual([view.tags, view.level], [['database_object'], 'medium']);
assert.deepEqual(risk('Codes/Db/Views/VehicleV.sql', ['    , v.OriginalDeliveryDate']).tags, [], 'a column added inside a view body is ordinary logic');
console.log('  ✓ SQL: tables/indexes are database_schema, views/procedures/functions are database_object');

// Rename without edits: its own kind, so the Read Strategy can rank it last.
const moved = { oldPath: 'Codes/Db/AuditLogV.sql', newPath: 'Codes/Db/AuditLog/AuditLogV.sql', status: 'renamed' as const, isBinary: false, additions: 0, deletions: 0, headerLines: [], hunks: [] };
assert.equal(ChangeClassifier.classify(moved).kind, 'rename_only');
console.log('  ✓ a pure rename is rename_only');

// Read Strategy: shape of a real PR where a +1/-1 .csproj was "Read next" and the new logic was only "Optional".
const entry = (id: string, change_kind: string, status: 'added' | 'modified', size: number, risk_tags: string[] = []) =>
  ({ id, path: `src/${id}.cs`, old_path: null, language: 'csharp', status, additions: size, deletions: 0, change_kind, risk_tags, detail_ref: '' });
const files = [
  entry('file_0001', 'configuration', 'modified', 2),
  entry('file_0002', 'functional_logic', 'modified', 22, ['public_api']),
  entry('file_0003', 'functional_logic', 'added', 102),
  entry('file_0004', 'functional_logic', 'added', 114),
  entry('file_0005', 'functional_logic', 'modified', 101),
  entry('file_0006', 'test_only', 'added', 99),
  entry('file_0007', 'rename_only', 'modified', 0)
];
const reading = ContextModeClassifier.classify({
  change_summary: { total_files: 7, total_additions: 440, total_deletions: 0, primary_kind: 'functional_logic', kind_counts: {} },
  risk_summary: { overall_level: 'medium', total_risk_tags: ['public_api'], risky_files_count: 0 }
} as any, files);
const ids = (refs: string[]) => refs.map(r => r.replace(/^files\/|\.md$/g, ''));
assert.deepEqual(ids(reading.required_next_files), ['file_0004', 'file_0003', 'file_0005', 'file_0002'], 'largest new logic first, public_api always included');
assert.deepEqual(ids(reading.optional_next_files), ['file_0001']);
assert.ok(reading.skip_categories.includes('low_priority: file_0006 (test_only), file_0007 (rename_only)'));
console.log('  ✓ Read Strategy ranks new and large logic first and lists low-value files by id');

// Symbols: real C# changes inside private methods and SQL objects used to yield none.
const hunkDiff = (path: string, header: string, lines: Array<['add' | 'context', string]>) => ({
  oldPath: path, newPath: path, status: 'modified' as const, isBinary: false, additions: lines.length, deletions: 0, headerLines: [],
  hunks: [{ header, oldStart: 70, oldLines: 1, newStart: 70, newLines: lines.length, lines: lines.map(([type, content]) => ({ type, content })) }]
});
const cs = SymbolExtractor.extractSymbols(hunkDiff('src/Sms/AutogamiProvider.cs', '@@ -70,7 +70,8 @@ namespace CRM.Infrastructure.Sms', [
  ['context', '        private async Task<SendSmsResponse> SendAsync(string to)'],
  ['add', '            ErrorContent = apiResponse?.Error?.Content']
]), false);
assert.ok(cs.some(s => s.kind === 'method' && s.name === 'SendAsync'), 'private async method');
assert.ok(cs.some(s => s.relationship === 'containing_symbol' && s.name === 'namespace CRM.Infrastructure.Sms'), 'hunk header context');
const sql = SymbolExtractor.extractSymbols(hunkDiff('Codes/Db/X.sql', '@@ -0,0 +1,2 @@', [
  ['add', 'CREATE NONCLUSTERED INDEX [IX_AuditLog_DocKey]'],
  ['add', 'CREATE OR ALTER VIEW [dbo].[AuditLogTemplateCrcV] AS']
]), false);
assert.deepEqual(sql.map(s => [s.kind, s.name]), [['sql_index', 'IX_AuditLog_DocKey'], ['sql_view', 'dbo.AuditLogTemplateCrcV']]);
console.log('  ✓ symbols: any C# access modifier, hunk-header scope, SQL objects');

// Description text: Bitbucket's "\[x\]" escapes and trailing zero-width characters are noise for an agent.
assert.equal(TextNormalizer.normalize('* \\[Eagers\\] \\[WC-36\\]: done\n\n‌\n').text, '* [Eagers] [WC-36]: done');
assert.equal(TextNormalizer.normalize('keep `\\[x\\]` in code').text, 'keep `\\[x\\]` in code');
console.log('  ✓ description drops markdown escapes and zero-width characters outside code');

// Description: long text is capped with a visible marker, short text is untouched.
assert.equal(BitbucketAllowlistProjector.truncateDescription('short'), 'short');
const long = BitbucketAllowlistProjector.truncateDescription('x'.repeat(5000));
assert.ok(long.length < 4100 && long.endsWith('_[description truncated: 4000 of 5000 chars]_'));
console.log('  ✓ description truncation is announced');
