import fs from 'fs';
import path from 'path';
import { RevisionValidator } from '../src/core/output/revision.validator.js';

function runIntegrityTests() {
  console.log('🧪 [INTEGRITY TEST] Running Referential Integrity & Security Tests...');

  const tmpTestDir = path.resolve(process.cwd(), 'tests', '.tmp-integrity-test-' + Date.now());
  fs.mkdirSync(tmpTestDir, { recursive: true });

  try {
    // Write valid base files
    const manifest = {
      schema_version: '4.0',
      title: 'Integrity Test PR',
      description: 'Test',
      state: 'OPEN',
      is_draft: false,
      source_branch: 'feat',
      target_branch: 'main',
      source_commit: '1234567',
      target_commit: '7654321',
      ticket_id: null,
      change_summary: {
        total_files: 1,
        total_additions: 10,
        total_deletions: 2,
        primary_kind: 'functional_logic',
        kind_counts: { functional_logic: 1 }
      },
      risk_summary: { overall_level: 'none', total_risk_tags: [], risky_files_count: 0 },
      stats: { files_changed: 1, commits_count: 1 },
      important_file_ids: ['file_0001'],
      index_refs: { files_index: 'files.index.jsonl', commits: 'commits.jsonl', coverage: 'coverage.json' },
      redaction_summary: { scanned: true, redacted_items_count: 0 },
      analyzer_version: '4.0.0'
    };

    const fileIndex = {
      id: 'file_0001',
      path: 'src/app.ts',
      old_path: null,
      language: 'typescript',
      status: 'modified',
      additions: 10,
      deletions: 2,
      change_kind: 'functional_logic',
      risk_tags: [],
      detail_ref: 'files/file_0001/change.json'
    };

    const fileChange = {
      schema_version: '4.0',
      file_id: 'file_0001',
      classification: { kind: 'functional_logic', functional_change: true, confidence: 0.9, evidence: [] },
      symbols: [],
      risk: { level: 'none', tags: [], evidence: [] },
      patch_ref: 'patch.diff',
      context_ref: null,
      redaction_result: { scanned: true, content_modified: false }
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

    fs.writeFileSync(path.join(tmpTestDir, 'manifest.json'), JSON.stringify(manifest), 'utf-8');
    fs.writeFileSync(path.join(tmpTestDir, 'files.index.jsonl'), JSON.stringify(fileIndex), 'utf-8');
    fs.writeFileSync(path.join(tmpTestDir, 'commits.jsonl'), 'commit msg', 'utf-8');
    fs.writeFileSync(path.join(tmpTestDir, 'coverage.json'), JSON.stringify(coverage), 'utf-8');

    const fileSubDir = path.join(tmpTestDir, 'files', 'file_0001');
    fs.mkdirSync(fileSubDir, { recursive: true });
    fs.writeFileSync(path.join(fileSubDir, 'change.json'), JSON.stringify(fileChange), 'utf-8');
    fs.writeFileSync(path.join(fileSubDir, 'patch.diff'), 'diff text', 'utf-8');

    // Test 1: Valid revision passes
    const validRes = RevisionValidator.validate(tmpTestDir);
    if (!validRes.valid) {
      throw new Error(`Expected valid revision to pass, but got errors: ${validRes.errors.join(', ')}`);
    }
    console.log('  ✅ Valid revision pass test passed');

    // Test 2: Missing detail_ref file fails
    fs.rmSync(path.join(fileSubDir, 'change.json'));
    const missingRes = RevisionValidator.validate(tmpTestDir);
    if (missingRes.valid) {
      throw new Error('Expected missing detail_ref file to fail validation');
    }
    console.log('  ✅ Missing file reference detection passed');

    // Restore change.json
    fs.writeFileSync(path.join(fileSubDir, 'change.json'), JSON.stringify(fileChange), 'utf-8');

    // Test 3: Path Traversal detection
    const pathTraversalIndex = { ...fileIndex, detail_ref: '../../outside.json' };
    fs.writeFileSync(path.join(tmpTestDir, 'files.index.jsonl'), JSON.stringify(pathTraversalIndex), 'utf-8');
    const traversalRes = RevisionValidator.validate(tmpTestDir);
    if (traversalRes.valid) {
      throw new Error('Expected path traversal in detail_ref to fail validation');
    }
    console.log('  ✅ Path traversal detection passed');

    console.log('🎉 [INTEGRITY TEST] All integrity tests passed successfully!\n');
  } finally {
    if (fs.existsSync(tmpTestDir)) {
      fs.rmSync(tmpTestDir, { recursive: true, force: true });
    }
  }
}

runIntegrityTests();
