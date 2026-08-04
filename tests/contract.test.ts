import { PRManifestV4Schema } from '../src/core/output/schema/manifest.v4.schema.js';
import { FileIndexEntryV4Schema } from '../src/core/output/schema/file_index.v4.schema.js';
import { FileChangeV4Schema } from '../src/core/output/schema/file_change.v4.schema.js';
import { PRCoverageV4Schema } from '../src/core/output/schema/coverage.v4.schema.js';

function runContractTests() {
  console.log('🧪 [CONTRACT TEST] Running Runtime Schema Validation Tests...');

  // 1. Manifest Contract Test
  const sampleManifest = {
    schema_version: '4.0',
    title: 'Feat: Add CRC Controller & comment updates',
    description: 'Thêm mới controller và cập nhật comment',
    state: 'OPEN',
    is_draft: false,
    source_branch: 'feature/crc',
    target_branch: 'main',
    source_commit: 'abc123456789',
    target_commit: 'def987654321',
    ticket_id: 'PR-4565',
    change_summary: {
      total_files: 1,
      total_additions: 5,
      total_deletions: 2,
      primary_kind: 'comment_only',
      kind_counts: { comment_only: 1 }
    },
    risk_summary: {
      overall_level: 'none',
      total_risk_tags: [],
      risky_files_count: 0
    },
    stats: {
      files_changed: 1,
      commits_count: 1
    },
    important_file_ids: ['file_0001'],
    index_refs: {
      files_index: 'files.index.jsonl',
      commits: 'commits.jsonl',
      coverage: 'coverage.json'
    },
    redaction_summary: {
      scanned: true,
      redacted_items_count: 0
    },
    analyzer_version: '4.0.0',
    provenance: {
      generated_at: new Date().toISOString(),
      provider: 'bitbucket',
      repository: 'workspace/repo',
      pull_request_id: 4565,
      normalization_version: '1.0.0'
    }
  };

  PRManifestV4Schema.parse(sampleManifest);
  console.log('  ✅ ManifestV4Schema parsed successfully');

  // 2. File Index Contract Test
  const sampleFileIndex = {
    id: 'file_0001',
    path: 'src/.../Controllers/CRCController.cs',
    old_path: null,
    language: 'csharp',
    status: 'modified',
    additions: 5,
    deletions: 2,
    change_kind: 'comment_only',
    risk_tags: [],
    detail_ref: 'files/file_0001/change.json',
    path_redacted: true,
    path_mode: 'sanitized'
  };

  FileIndexEntryV4Schema.parse(sampleFileIndex);
  console.log('  ✅ FileIndexEntryV4Schema parsed successfully');

  // 3. File Change Contract Test
  const sampleFileChange = {
    schema_version: '4.0',
    file_id: 'file_0001',
    classification: {
      kind: 'comment_only',
      functional_change: false,
      confidence: 1.0,
      evidence: ['Only comment changes in file']
    },
    symbols: [
      {
        kind: 'constructor',
        name: 'CRCController',
        change: 'comment_near_symbol',
        signature: 'public CRCController()',
        line: 15,
        confidence: 0.95,
        relationship: 'nearest_symbol'
      }
    ],
    risk: {
      level: 'none',
      tags: [],
      evidence: []
    },
    patch_ref: 'patch.diff',
    context_ref: null,
    redaction_result: {
      scanned: true,
      content_modified: false
    }
  };

  FileChangeV4Schema.parse(sampleFileChange);
  console.log('  ✅ FileChangeV4Schema parsed successfully');

  // 4. Coverage Contract Test
  const sampleCoverage = {
    schema_version: '4.0',
    sections: {
      metadata: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
      commits: { status: 'complete', truncated: false, items_fetched: 2, warning: null },
      diffstat: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
      diff: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
      file_analysis: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
      symbols: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
      comments: { status: 'not_available', truncated: false, items_fetched: 0, warning: 'Bitbucket PR comments not configured' },
      ci: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
      related_context: { status: 'not_requested', truncated: false, items_fetched: 0, warning: null }
    }
  };

  PRCoverageV4Schema.parse(sampleCoverage);
  console.log('  ✅ PRCoverageV4Schema parsed successfully');

  console.log('🎉 [CONTRACT TEST] All schemas passed validation!\n');
}

runContractTests();
