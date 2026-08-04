import fs from 'fs';
import path from 'path';
import { RevisionWriter } from '../src/core/output/revision.writer.js';
import { OutputReader } from '../src/core/output/output.reader.js';

function runAtomicWriteTests() {
  console.log('🧪 [ATOMIC WRITE TEST] Running Atomic Revision Publish Tests...');

  const workspace = 'test-ws';
  const repoSlug = 'test-repo';
  const prId = 9999;
  const prDir = RevisionWriter.getPROutputDir(workspace, repoSlug, prId);

  // Clean up any existing test output dir
  if (fs.existsSync(prDir)) {
    fs.rmSync(prDir, { recursive: true, force: true });
  }

  try {
    // 1. Write Initial Valid Revision 1
    const rev1Result = RevisionWriter.writeRevision(
      workspace,
      repoSlug,
      prId,
      'src00000000000000000000000000000000001',
      'tgt00000000000000000000000000000000001',
      {
        title: 'Initial Revision',
        description: 'First revision',
        state: 'OPEN',
        is_draft: false,
        source_branch: 'feature',
        target_branch: 'main',
        source_commit: 'src0000',
        target_commit: 'tgt0000',
        ticket_id: null,
        change_summary: {
          total_files: 1,
          total_additions: 5,
          total_deletions: 0,
          primary_kind: 'functional_logic',
          kind_counts: { functional_logic: 1 }
        },
        risk_summary: { overall_level: 'none', total_risk_tags: [], risky_files_count: 0 },
        stats: { files_changed: 1, commits_count: 1 },
        important_file_ids: ['file_0001'],
        index_refs: { files_index: 'files.index.jsonl', commits: 'commits.jsonl', coverage: 'coverage.json' },
        redaction_summary: { scanned: true, redacted_items_count: 0 },
        analyzer_version: '4.0.0'
      },
      [
        {
          id: 'file_0001',
          path: 'src/main.ts',
          old_path: null,
          language: 'typescript',
          status: 'modified',
          additions: 5,
          deletions: 0,
          change_kind: 'functional_logic',
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
              classification: { kind: 'functional_logic', functional_change: true, confidence: 0.9, evidence: [] },
              symbols: [],
              risk: { level: 'none', tags: [], evidence: [] },
              patch_ref: 'patch.diff',
              context_ref: null,
              redaction_result: { scanned: true, content_modified: false }
            },
            diffContent: 'diff'
          }
        ]
      ]),
      ['Commit 1'],
      {
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
      }
    );

    console.log(`  ✅ Revision 1 created: ${rev1Result.revisionId}`);

    // Verify current.json points to Revision 1
    const active1 = OutputReader.getActiveRevision(workspace, repoSlug, prId);
    if (active1?.current.active_revision !== rev1Result.revisionId) {
      throw new Error(`Expected active revision to be ${rev1Result.revisionId}`);
    }

    // 2. Attempt Erroneous Revision 2 (Mismatched additions counter = 999)
    let failedAsExpected = false;
    try {
      RevisionWriter.writeRevision(
        workspace,
        repoSlug,
        prId,
        'src00000000000000000000000000000000002',
        'tgt00000000000000000000000000000000002',
        {
          title: 'Corrupted Revision 2',
          description: 'Should fail',
          state: 'OPEN',
          is_draft: false,
          source_branch: 'feature2',
          target_branch: 'main',
          source_commit: 'src0002',
          target_commit: 'tgt0002',
          ticket_id: null,
          change_summary: {
            total_files: 1,
            total_additions: 999, // Mismatch! Real additions = 5
            total_deletions: 0,
            primary_kind: 'functional_logic',
            kind_counts: { functional_logic: 1 }
          },
          risk_summary: { overall_level: 'none', total_risk_tags: [], risky_files_count: 0 },
          stats: { files_changed: 1, commits_count: 1 },
          important_file_ids: ['file_0001'],
          index_refs: { files_index: 'files.index.jsonl', commits: 'commits.jsonl', coverage: 'coverage.json' },
          redaction_summary: { scanned: true, redacted_items_count: 0 },
          analyzer_version: '4.0.0'
        },
        [
          {
            id: 'file_0001',
            path: 'src/main.ts',
            old_path: null,
            language: 'typescript',
            status: 'modified',
            additions: 5,
            deletions: 0,
            change_kind: 'functional_logic',
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
                classification: { kind: 'functional_logic', functional_change: true, confidence: 0.9, evidence: [] },
                symbols: [],
                risk: { level: 'none', tags: [], evidence: [] },
                patch_ref: 'patch.diff',
                context_ref: null,
                redaction_result: { scanned: true, content_modified: false }
              },
              diffContent: 'diff'
            }
          ]
        ]),
        ['Commit 2'],
        {
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
        }
      );
    } catch (err: any) {
      failedAsExpected = true;
      console.log(`  ✅ Erroneous Revision 2 failed as expected with error: ${err.message.split('\n')[0]}`);
    }

    if (!failedAsExpected) {
      throw new Error('Expected Erroneous Revision 2 to throw a validation error');
    }

    // Verify current.json STILL points to Revision 1 and was not updated!
    const activeAfterFail = OutputReader.getActiveRevision(workspace, repoSlug, prId);
    if (activeAfterFail?.current.active_revision !== rev1Result.revisionId) {
      throw new Error(
        `Atomic publish failed! Active revision changed to ${activeAfterFail?.current.active_revision} after failed generation`
      );
    }

    console.log('  ✅ Atomic publish rollback verified: current.json remains active on Revision 1');
    console.log('🎉 [ATOMIC WRITE TEST] All atomic write tests passed successfully!\n');
  } finally {
    if (fs.existsSync(prDir)) {
      fs.rmSync(prDir, { recursive: true, force: true });
    }
  }
}

runAtomicWriteTests();
