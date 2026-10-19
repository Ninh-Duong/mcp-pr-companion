import fs from 'fs';
import path from 'path';
import { PRManifestV4 } from './schema/manifest.v4.schema.js';
import { FileIndexEntryV4 } from './schema/file_index.v4.schema.js';
import { FileChangeV4 } from './schema/file_change.v4.schema.js';
import { PRCoverageV4 } from './schema/coverage.v4.schema.js';
import { RevisionValidator } from './revision.validator.js';
import { TextNormalizer } from '../../utils/text.normalizer.js';
import { StorePathResolver } from './store-path.resolver.js';
import { MarkdownFormatter } from './markdown.formatter.js';
import { ContextModeClassifier } from '../analyzer/context-mode.classifier.js';
import { AtomicWriter } from '../storage/atomic.writer.js';

export class RevisionWriter {
  static getPROutputDir(workspace: string, repoSlug: string, prId: number, company?: string, root?: string): string {
    return StorePathResolver.getBitbucketPRDir(workspace, repoSlug, prId, company, root);
  }

  static writeRevision(
    workspace: string,
    repoSlug: string,
    prId: number,
    sourceHash: string,
    destinationHash: string,
    manifestData: Omit<PRManifestV4, 'schema_version'>,
    fileEntries: FileIndexEntryV4[],
    fileChangesMap: Map<string, { change: FileChangeV4; diffContent: string }>,
    commitsJsonl: string[],
    coverageData: PRCoverageV4,
    company?: string,
    root?: string
  ): { revisionId: string; manifest: PRManifestV4; prDir: string; revisionDir: string } {
    const prDir = this.getPROutputDir(workspace, repoSlug, prId, company, root);
    const shortSrc = sourceHash.substring(0, 7);
    const shortTgt = destinationHash.substring(0, 7);
    const revisionId = `rev_${shortSrc}_${shortTgt}`;
    const revisionsDir = path.join(prDir, 'revisions');
    const targetRevDir = path.join(revisionsDir, revisionId);

    // Staging directory for atomic writes
    const tmpRevDir = path.join(revisionsDir, `.tmp-${revisionId}-${Date.now()}`);
    fs.mkdirSync(tmpRevDir, { recursive: true });

    try {
      // 0. Text Normalization for Title and Description
      const normalizedTitle = TextNormalizer.normalize(manifestData.title || '');
      const normalizedDesc = TextNormalizer.normalize(manifestData.description || '');

      const nowIso = new Date().toISOString();

      // Compute AI Reading metadata
      const aiReading = ContextModeClassifier.classify(manifestData, fileEntries);

      const fullManifest: PRManifestV4 = {
        schema_version: '4.0',
        ...manifestData,
        title: normalizedTitle.text,
        description: normalizedDesc.text,
        description_meta: {
          mode: normalizedDesc.isNormalized ? 'normalized' : 'raw'
        },
        ai_reading: aiReading,
        provenance: {
          generated_at: nowIso,
          provider: 'bitbucket',
          repository: `${workspace}/${repoSlug}`,
          pull_request_id: prId,
          normalization_version: '1.0.0'
        }
      };

      // 1. Write manifest.json
      fs.writeFileSync(path.join(tmpRevDir, 'manifest.json'), JSON.stringify(fullManifest, null, 2), 'utf-8');

      // 2. Write files.index.jsonl
      const indexLines = fileEntries.map(e => JSON.stringify(e)).join('\n');
      fs.writeFileSync(path.join(tmpRevDir, 'files.index.jsonl'), indexLines, 'utf-8');

      // 3. Write commits.jsonl
      fs.writeFileSync(path.join(tmpRevDir, 'commits.jsonl'), commitsJsonl.join('\n'), 'utf-8');

      // 4. Write coverage.json
      fs.writeFileSync(path.join(tmpRevDir, 'coverage.json'), JSON.stringify(coverageData, null, 2), 'utf-8');

      // 5. Write files detail and patch diffs
      const filesDir = path.join(tmpRevDir, 'files');
      fileChangesMap.forEach(({ change, diffContent }, fileId) => {
        const fileSubDir = path.join(filesDir, fileId);
        fs.mkdirSync(fileSubDir, { recursive: true });
        fs.writeFileSync(path.join(fileSubDir, 'change.json'), JSON.stringify(change, null, 2), 'utf-8');
        fs.writeFileSync(path.join(fileSubDir, 'patch.diff'), diffContent, 'utf-8');
      });

      // 6. Pre-Publish Validation Gate
      RevisionValidator.validateOrThrow(tmpRevDir);

      // Replace target directory atomically if it exists
      if (fs.existsSync(targetRevDir)) {
        fs.rmSync(targetRevDir, { recursive: true, force: true });
      }
      fs.renameSync(tmpRevDir, targetRevDir);

      // 7. Top-level AI context pack. Each file is replaced atomically; files/ is rebuilt aside and
      //    swapped in so ids from an older, larger revision never linger.
      const topFilesDir = path.join(prDir, 'files');
      const tmpFilesDir = path.join(prDir, `.tmp-files-${Date.now()}`);
      fs.mkdirSync(tmpFilesDir, { recursive: true });
      fileEntries.forEach(entry => {
        const detail = fileChangesMap.get(entry.id);
        if (detail) fs.writeFileSync(path.join(tmpFilesDir, `${entry.id}.md`), MarkdownFormatter.formatFileDetail(entry, detail), 'utf-8');
      });
      fs.rmSync(topFilesDir, { recursive: true, force: true });
      fs.renameSync(tmpFilesDir, topFilesDir);

      AtomicWriter.writeFileSync(path.join(prDir, 'context.md'), MarkdownFormatter.formatContextPack(`${workspace}/${repoSlug}`, fullManifest, commitsJsonl, aiReading));
      AtomicWriter.writeFileSync(path.join(prDir, 'files.md'), MarkdownFormatter.formatFilesSummaryList(fileEntries));
      AtomicWriter.writeFileSync(path.join(prDir, 'actions.md'), MarkdownFormatter.formatActionsSummary(coverageData));
      // Top-level manifest.json kept for backward compatibility.
      AtomicWriter.writeFileSync(path.join(prDir, 'manifest.json'), JSON.stringify(fullManifest, null, 2));

      // 8. current.json is the commit point: written last, only after validation and the pack succeeded.
      const currentData = {
        active_revision: revisionId,
        updated_at: nowIso,
        generated_at: nowIso,
        source_commit: sourceHash,
        source_hash: sourceHash,
        target_commit: destinationHash,
        destination_hash: destinationHash,
        context_path: 'context.md',
        files_summary_path: 'files.md',
        actions_path: 'actions.md',
        manifest_path: 'manifest.json',
        active_revision_path: `revisions/${revisionId}`,
        ai_reading_mode: aiReading.mode
      };
      AtomicWriter.writeFileSync(path.join(prDir, 'current.json'), JSON.stringify(currentData, null, 2));

      this.pruneRevisions(revisionsDir, revisionId);

      return {
        revisionId,
        manifest: fullManifest,
        prDir,
        revisionDir: targetRevDir
      };
    } catch (err) {
      // Clean up tmpRevDir on failure to ensure atomic-write safety
      if (fs.existsSync(tmpRevDir)) {
        fs.rmSync(tmpRevDir, { recursive: true, force: true });
      }
      throw err;
    }
  }

  // ponytail: fixed keep-count by mtime; make it configurable if anyone needs older revisions.
  static readonly KEEP_REVISIONS = 5;

  private static pruneRevisions(revisionsDir: string, activeRevision: string): void {
    const old = fs.readdirSync(revisionsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== activeRevision)
      .map(e => ({ dir: path.join(revisionsDir, e.name), mtime: fs.statSync(path.join(revisionsDir, e.name)).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(this.KEEP_REVISIONS - 1);
    for (const { dir } of old) fs.rmSync(dir, { recursive: true, force: true });
  }
}
