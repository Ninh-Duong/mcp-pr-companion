import fs from 'fs';
import path from 'path';
import { RevisionValidator } from '../src/core/output/revision.validator.js';

function runAggregateTests() {
  console.log('🧪 [AGGREGATE TEST] Running Aggregate Counter Validation Tests...');

  const tmpTestDir = path.resolve(process.cwd(), 'tests', '.tmp-aggregate-test-' + Date.now());
  fs.mkdirSync(tmpTestDir, { recursive: true });

  try {
    const fileIndex1 = {
      id: 'file_0001',
      path: 'src/a.ts',
      old_path: null,
      language: 'typescript',
      status: 'modified',
      additions: 15,
      deletions: 5,
      change_kind: 'functional_logic',
      risk_tags: [],
      detail_ref: 'files/file_0001/change.json'
    };

    const fileIndex2 = {
      id: 'file_0002',
      path: 'src/b.ts',
      old_path: null,
      language: 'typescript',
      status: 'added',
      additions: 20,
      deletions: 0,
      change_kind: 'functional_logic',
      risk_tags: [],
      detail_ref: 'files/file_0002/change.json'
    };

    // Manifest with WRONG total_additions (100 instead of 35)
    const MismatchedManifest = {
      schema_version: '4.0',
      title: 'Aggregate Test',
      description: 'Test',
      state: 'OPEN',
      is_draft: false,
      source_branch: 'feat',
      target_branch: 'main',
      source_commit: '1234567',
      target_commit: '7654321',
      ticket_id: null,
      change_summary: {
        total_files: 2,
        total_additions: 100, // Mismatched! Expected 35
        total_deletions: 5,
        primary_kind: 'functional_logic',
        kind_counts: { functional_logic: 2 }
      },
      risk_summary: { overall_level: 'none', total_risk_tags: [], risky_files_count: 0 },
      stats: { files_changed: 2, commits_count: 1 },
      important_file_ids: ['file_0001', 'file_non_existent'], // file_non_existent does not exist!
      index_refs: { files_index: 'files.index.jsonl', commits: 'commits.jsonl', coverage: 'coverage.json' },
      redaction_summary: { scanned: true, redacted_items_count: 0 },
      analyzer_version: '4.0.0'
    };

    const coverage = {
      schema_version: '4.0',
      sections: {
        metadata: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        commits: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        diffstat: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        diff: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        file_analysis: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        symbols: { status: 'complete', truncated: false, items_fetched: 0, warning: null },
        comments: { status: 'not_requested', truncated: false, items_fetched: 0, warning: null },
        ci: { status: 'not_available', truncated: false, items_fetched: 0, warning: null },
        related_context: { status: 'not_requested', truncated: false, items_fetched: 0, warning: null }
      }
    };

    fs.writeFileSync(path.join(tmpTestDir, 'manifest.json'), JSON.stringify(MismatchedManifest), 'utf-8');
    fs.writeFileSync(
      path.join(tmpTestDir, 'files.index.jsonl'),
      `${JSON.stringify(fileIndex1)}\n${JSON.stringify(fileIndex2)}`,
      'utf-8'
    );
    fs.writeFileSync(path.join(tmpTestDir, 'commits.jsonl'), 'commit msg', 'utf-8');
    fs.writeFileSync(path.join(tmpTestDir, 'coverage.json'), JSON.stringify(coverage), 'utf-8');

    const makeFileDir = (fileId: string) => {
      const dir = path.join(tmpTestDir, 'files', fileId);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, 'change.json'),
        JSON.stringify({
          schema_version: '4.0',
          file_id: fileId,
          classification: { kind: 'functional_logic', functional_change: true, confidence: 0.9, evidence: [] },
          symbols: [],
          risk: { level: 'none', tags: [], evidence: [] },
          patch_ref: 'patch.diff',
          context_ref: null,
          redaction_result: { scanned: true, content_modified: false }
        }),
        'utf-8'
      );
      fs.writeFileSync(path.join(dir, 'patch.diff'), 'diff', 'utf-8');
    };

    makeFileDir('file_0001');
    makeFileDir('file_0002');

    const res = RevisionValidator.validate(tmpTestDir);
    if (res.valid) {
      throw new Error('Expected aggregate mismatch and invalid important_file_id to fail validation');
    }

    const hasAdditionErr = res.errors.some(e => e.includes('total_additions'));
    const hasImpFileErr = res.errors.some(e => e.includes('important_file_id'));

    if (!hasAdditionErr || !hasImpFileErr) {
      throw new Error(`Expected specific error messages for total_additions and important_file_id, got: ${res.errors.join('; ')}`);
    }

    console.log('  ✅ Mismatched total_additions detected correctly');
    console.log('  ✅ Invalid important_file_id detected correctly');
    console.log('🎉 [AGGREGATE TEST] All aggregate validation tests passed successfully!\n');
  } finally {
    if (fs.existsSync(tmpTestDir)) {
      fs.rmSync(tmpTestDir, { recursive: true, force: true });
    }
  }
}

runAggregateTests();
