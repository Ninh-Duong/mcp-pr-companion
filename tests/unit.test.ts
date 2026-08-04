import { Redactor } from '../src/utils/redactor.js';
import { PRRegistry } from '../src/core/registry/pr.registry.js';
import { CapabilityGuard } from '../src/config/capability.guard.js';
import { ConfigManager } from '../src/config/config.manager.js';
import { CacheIndex } from '../src/core/storage/cache.index.js';
import { DiffParser } from '../src/core/analyzer/diff.parser.js';
import { ChangeClassifier } from '../src/core/analyzer/change.classifier.js';
import { RiskAnalyzer } from '../src/core/analyzer/risk.analyzer.js';
import { SymbolExtractor } from '../src/core/analyzer/symbol.extractor.js';
import { RevisionWriter } from '../src/core/output/revision.writer.js';
import { OutputReader } from '../src/core/output/output.reader.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`  ✓ ${testName}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n================================================================');
  console.log('            Running Unit & Integration Tests (Schema v4)        ');
  console.log('================================================================\n');

  // 1. Redactor Tests
  console.log('1. Redactor & Secret Masking:');
  const token = 'ATBB1234567890abcdef';
  const masked = Redactor.maskToken(token);
  assert(masked === 'ATBB****cdef', 'Redactor.maskToken masks token with ATBB****suffix format');

  const rawLog = `Connecting with Authorization: Basic dXNlcjp0b2tlbg== and token "token": "${token}"`;
  const redacted = Redactor.redact(rawLog);
  assert(!redacted.includes(token) || redacted.includes('ATBB****cdef'), 'Redactor sanitizes tokens from log text');

  // 2. PRRegistry Tests
  console.log('\n2. PRRegistry & URL Canonicalization:');
  const validUrl = 'https://bitbucket.org/myworkspace/myrepo/pull-requests/4158';
  const parsed = PRRegistry.parseAndValidateUrl(validUrl);
  assert(parsed.workspace === 'myworkspace' && parsed.repoSlug === 'myrepo' && parsed.prId === 4158, 'parseAndValidateUrl extracts workspace, repo, and prId');

  const dotRepoUrl = 'https://bitbucket.org/siliconstack/wec.be/pull-requests/4565';
  const dotParsed = PRRegistry.parseAndValidateUrl(dotRepoUrl);
  assert(dotParsed.repoSlug === 'wec.be' && dotParsed.prId === 4565, 'parseAndValidateUrl accepts repository names containing dots (wec.be)');

  // 3. DiffParser Tests
  console.log('\n3. DiffParser Multi-File Parsing:');
  const rawSampleDiff = `diff --git a/src/Controllers/CRCController.cs b/src/Controllers/CRCController.cs
index 1234567..89abcdef 100644
--- a/src/Controllers/CRCController.cs
+++ b/src/Controllers/CRCController.cs
@@ -10,4 +10,4 @@ public class CRCController
-        // Old comment
+        // New comment updated
`;
  const parsedDiff = DiffParser.parse(rawSampleDiff);
  assert(parsedDiff.files.length === 1, 'DiffParser parses single file diff from patch text');
  assert(parsedDiff.files[0].newPath === 'src/Controllers/CRCController.cs', 'DiffParser extracts new file path');
  assert(parsedDiff.files[0].additions === 1 && parsedDiff.files[0].deletions === 1, 'DiffParser counts additions and deletions accurately');

  // 4. ChangeClassifier & RiskAnalyzer Tests
  console.log('\n4. ChangeClassifier & RiskAnalyzer Correctness:');
  const controllerCommentDiff = parsedDiff.files[0];
  const commentClassification = ChangeClassifier.classify(controllerCommentDiff);
  assert(commentClassification.kind === 'comment_only', 'Controller with only comment line changes is classified as comment_only');
  assert(commentClassification.functionalChange === false, 'comment_only classification sets functionalChange to false');

  const commentRisk = RiskAnalyzer.analyze(controllerCommentDiff, commentClassification);
  assert(commentRisk.level === 'none', 'Controller comment-only change has risk level "none"');
  assert(!commentRisk.tags.includes('public_api'), 'Controller comment-only change does NOT generate false positive public_api risk tag');

  // Controller Route Change Test
  const rawRouteDiff = `diff --git a/src/Controllers/CRCController.cs b/src/Controllers/CRCController.cs
--- a/src/Controllers/CRCController.cs
+++ b/src/Controllers/CRCController.cs
@@ -15,2 +15,3 @@ public class CRCController
+        [HttpPost("submit")]
+        public async Task<IActionResult> SubmitData([FromBody] RequestDto dto)
`;
  const parsedRouteDiff = DiffParser.parse(rawRouteDiff);
  const routeClassification = ChangeClassifier.classify(parsedRouteDiff.files[0]);
  const routeRisk = RiskAnalyzer.analyze(parsedRouteDiff.files[0], routeClassification);
  assert(routeRisk.tags.includes('public_api'), 'Controller HTTP route addition correctly generates public_api risk tag');

  // 5. SymbolExtractor Tests
  console.log('\n5. SymbolExtractor AST Change Extraction:');
  const symbols = SymbolExtractor.extractSymbols(parsedRouteDiff.files[0], false);
  assert(symbols.some(s => s.kind === 'route' && s.name.includes('POST /submit')), 'SymbolExtractor extracts POST /submit API route');
  assert(symbols.some(s => s.kind === 'method' && s.name === 'SubmitData'), 'SymbolExtractor extracts SubmitData method');

  // 6. RevisionWriter & OutputReader Tests
  console.log('\n6. RevisionWriter & OutputReader Schema v4 Storage:');
  const testWs = 'testws';
  const testRepo = 'testrepo';
  const testPr = 9999;
  const srcCommit = '1111111111111111111111111111111111111111';
  const tgtCommit = '2222222222222222222222222222222222222222';

  const written = RevisionWriter.writeRevision(
    testWs,
    testRepo,
    testPr,
    srcCommit,
    tgtCommit,
    {
      title: 'Test PR Title',
      description: 'Test PR Description',
      state: 'OPEN',
      is_draft: false,
      source_branch: 'feature/test',
      target_branch: 'main',
      source_commit: srcCommit,
      target_commit: tgtCommit,
      ticket_id: 'WEC-999',
      change_summary: { total_files: 1, total_additions: 1, total_deletions: 1, primary_kind: 'comment_only', kind_counts: { comment_only: 1 } },
      risk_summary: { overall_level: 'none', total_risk_tags: [], risky_files_count: 0 },
      stats: { files_changed: 1, commits_count: 1 },
      important_file_ids: [],
      index_refs: { files_index: 'files.index.jsonl', commits: 'commits.jsonl', coverage: 'coverage.json' },
      redaction_summary: { scanned: true, redacted_items_count: 0 },
      analyzer_version: '4.0.0'
    },
    [
      {
        id: 'file_0001',
        path: 'src/Controllers/CRCController.cs',
        old_path: null,
        language: 'csharp',
        status: 'modified',
        additions: 1,
        deletions: 1,
        change_kind: 'comment_only',
        risk_tags: [],
        detail_ref: 'files/file_0001/change.json'
      }
    ],
    new Map([
      [
        'file_0001',
        {
          change: {
            schema_version: '4.0',
            file_id: 'file_0001',
            classification: {
              kind: commentClassification.kind,
              functional_change: commentClassification.functionalChange,
              confidence: commentClassification.confidence,
              evidence: commentClassification.evidence
            },
            symbols: [],
            risk: commentRisk,
            patch_ref: 'patch.diff',
            context_ref: null,
            redaction_result: { scanned: true, content_modified: false }
          },
          diffContent: rawSampleDiff
        }
      ]
    ]),
    [JSON.stringify({ hash: srcCommit, subject: 'Update comments' })],
    {
      schema_version: '4.0',
      sections: {
        metadata: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        commits: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        diffstat: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        diff: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        file_analysis: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        symbols: { status: 'complete', truncated: false, items_fetched: 0, warning: null },
        comments: { status: 'not_fetched', truncated: false, items_fetched: 0, warning: null },
        ci: { status: 'not_fetched', truncated: false, items_fetched: 0, warning: null },
        related_context: { status: 'not_fetched', truncated: false, items_fetched: 0, warning: null }
      }
    }
  );

  assert(written.manifest.schema_version === '4.0', 'RevisionWriter writes manifest with schema_version 4.0');

  const active = OutputReader.getActiveRevision(testWs, testRepo, testPr);
  assert(active !== null && active.current.active_revision === written.revisionId, 'OutputReader loads active revision pointer from current.json');

  const loadedChangeByStr = OutputReader.getFileChange(testWs, testRepo, testPr, 'file_0001');
  assert(loadedChangeByStr !== null && loadedChangeByStr.change.file_id === 'file_0001', 'OutputReader reads per-file change by string file_id ("file_0001")');

  const loadedChangeByNum = OutputReader.getFileChange(testWs, testRepo, testPr, '1' as any);
  assert(loadedChangeByNum !== null && loadedChangeByNum.change.file_id === 'file_0001', 'OutputReader supports numeric coercion fallback for file_id (1 -> "file_0001")');

  console.log('\n================================================================');
  console.log(`Test Results: ${passed} Passed | ${failed} Failed`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution error:', err);
  process.exit(1);
});
