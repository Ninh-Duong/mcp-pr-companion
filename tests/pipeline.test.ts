// DataStore.saveRevision on awkward real-world inputs: opaque renames, missing patches, merge conflicts,
// partial downloads and secrets in hunk headers. Runs in a temp cwd (tests/run.mjs).
import assert from 'node:assert/strict';

process.env.PRIVACY_FILE_PATH_MODE = 'opaque';
const { AccessGate } = await import('../src/core/auth/access-gate.ts');
const { DataStore } = await import('../src/core/storage/data.store.ts');
const { OutputReader } = await import('../src/core/output/output.reader.ts');

const [WS, REPO, PR] = ['acme', 'pipe', 9];
AccessGate.setMaterial(WS, REPO, '{00000000-0000-0000-0000-000000000009}');

const token = 'ghp_' + 'a1B2c3D4e5'.repeat(4);
const rawDiff = [
  'diff --git a/lib/src/a.ts b/src/a.ts',
  'similarity index 90%',
  'rename from lib/src/a.ts',
  'rename to src/a.ts',
  '--- a/lib/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1 +1,2 @@',
  ' x',
  '+y',
  'diff --git a/src/scope.ts b/src/scope.ts',
  '--- a/src/scope.ts',
  '+++ b/src/scope.ts',
  `@@ -1 +1,2 @@ ${'x'.repeat(110)} ${token}`,
  ' a',
  '+b',
  ''
].join('\n');

DataStore.saveRevision(WS, REPO, PR, {
  metadata: {
    id: PR, title: 'Edge cases', description: '', state: 'OPEN',
    source: { branch: { name: 'feature/x' }, commit: { hash: 'a'.repeat(40) } },
    destination: { branch: { name: 'main' }, commit: { hash: 'b'.repeat(40) } }
  },
  commits: [{ hash: 'a'.repeat(40), message: 'edge cases' }],
  diffstat: [
    { status: 'renamed', old: { path: 'lib/src/a.ts' }, new: { path: 'src/a.ts' }, lines_added: 1, lines_removed: 0 },
    { status: 'modified', new: { path: 'src/scope.ts' }, lines_added: 1, lines_removed: 0 },
    { status: 'modified', new: { path: 'src/missing.ts' }, lines_added: 5, lines_removed: 2 },
    { status: 'merge conflict', old: { path: 'src/conflict.ts' }, new: { path: 'src/conflict.ts' }, lines_added: 2, lines_removed: 1 },
    { status: 'remote deleted', old: { path: 'src/gone.ts' }, lines_added: 0, lines_removed: 4 }
  ],
  rawDiff,
  sourceHash: 'a'.repeat(40),
  destinationHash: 'b'.repeat(40),
  coverage: { metadata: 'complete', commits: 'complete', diffstat: 'complete', diff: 'partial' },
  warnings: ['Diff download stopped early']
});

const index = OutputReader.getFileIndex(WS, REPO, PR);
const change = (id: string) => OutputReader.getFileChange(WS, REPO, PR, id)!;

// A4: opaque mode, new path is a suffix of the old one: the header must not keep "lib/" (regression: "rename from lib/file_0001")
const renamedPatch = change('file_0001').diffContent ?? '';
assert.ok(!renamedPatch.includes('lib/') && !renamedPatch.includes('src/a.ts'), renamedPatch);
console.log('  ✓ opaque mode rewrites rename headers without leaking path fragments');

// D2: a token cut at the 120-char symbol limit must still be redacted
const scope = change('file_0002').change.symbols.find(s => s.relationship === 'containing_symbol');
assert.ok(scope && !scope.name.includes('ghp_') && scope.name.length <= 120, JSON.stringify(scope));
console.log('  ✓ symbol text is scanned for secrets before it is shortened');

// B1: a changed file without a patch is unknown and functional, never "whitespace_only"
assert.deepEqual([change('file_0003').change.classification.kind, change('file_0003').change.risk.level], ['unknown', 'low']);
console.log('  ✓ a missing patch is "unknown", not a harmless whitespace change');

// B3: Bitbucket's conflict statuses no longer fail validation, and conflicts are must-read
assert.deepEqual(index.map(f => f.status), ['renamed', 'modified', 'modified', 'modified', 'removed']);
assert.ok(index[3].risk_tags.includes('merge_conflict'));
assert.equal(change('file_0004').change.risk.level, 'high');
console.log('  ✓ "merge conflict" / "remote deleted" statuses sync, conflicts are tagged high');

// B2: incomplete downloads are visible in the pack
const pack = OutputReader.getContextPack(WS, REPO, PR)!;
assert.match(pack, /Warning: diff partial \(Diff download stopped early\)\. Some changes may be missing; call get_pr_context_pack with refresh=true\./);
assert.match(pack, /Read next: [^\n]*file_0004/, 'the conflicted file is read first');
console.log('  ✓ context pack warns about partial data and puts conflicts in Read next');

// C1: pack sections that grow with the PR are capped (invariant 4)
const { MarkdownFormatter } = await import('../src/core/output/markdown.formatter.ts');
const many = Array.from({ length: 250 }, (_, i) => ({
  id: `file_${String(i + 1).padStart(4, '0')}`, path: `src/f${i}.ts`, old_path: null, language: 'typescript', status: 'modified' as const,
  additions: 1, deletions: 0, change_kind: 'functional_logic', risk_tags: [], detail_ref: ''
}));
const manifest = OutputReader.getActiveRevision(WS, REPO, PR)!.manifest!;
const big = MarkdownFormatter.formatContextPack('acme/pipe', {
  ...manifest,
  changes_since_previous: { previous_revision: 'rev_x', changed_file_ids: many.map(f => f.id), removed_paths: many.map(f => `old/${f.path}`) }
}, [], { mode: 'deep_review', reason: '', required_next_files: [], optional_next_files: [], skip_categories: [], token_budget: 'extensive' }, many);
assert.equal((big.match(/^- file_\d{4} /gm) ?? []).length, 30);
assert.match(big, /- … 220 more changed files: use search_pr_files/);
assert.match(big, /No longer in the PR: (old\/src\/f\d+\.ts, ){19}old\/src\/f\d+\.ts \(\+230 more\)/);
const table = MarkdownFormatter.formatFilesSummaryList(many);
assert.equal((table.match(/^\| file_\d{4} /gm) ?? []).length, 200);
assert.match(table, /50 more files: use search_pr_files/);
console.log('  ✓ changed-since, removed paths and the file table are capped');
