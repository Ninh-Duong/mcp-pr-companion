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
import {
  copySecureTree,
  isEncryptedFile,
  PlaintextFileError,
  readSecure,
  secureTreesEqual,
  verifySecureTree,
  writeSecure
} from '../storage/secure-file.js';
import { PRStorageStatus } from '../pr-status.js';

export class RevisionWriter {
  static getPROutputDir(workspace: string, repoSlug: string, prId: number, company?: string, root?: string, status?: PRStorageStatus): string {
    return StorePathResolver.getBitbucketPRDir(workspace, repoSlug, prId, company, root, status);
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
    root?: string,
    status?: PRStorageStatus,
    previousPrDirs?: string[]
  ): { revisionId: string; manifest: PRManifestV4; prDir: string; revisionDir: string } {
    const prDir = this.getPROutputDir(workspace, repoSlug, prId, company, root, status);
    const shortSrc = sourceHash.substring(0, 7);
    const shortTgt = destinationHash.substring(0, 7);
    const revisionId = `rev_${shortSrc}_${shortTgt}`;
    const revisionsDir = path.join(prDir, 'revisions');
    const targetRevDir = path.join(revisionsDir, revisionId);
    // Every file is encrypted for this PR (AccessGate must have unlocked the repository).
    const scope = { workspace, repoSlug, prId };

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
      writeSecure(path.join(tmpRevDir, 'manifest.json'), JSON.stringify(fullManifest, null, 2), scope);

      // 2. Write files.index.jsonl
      const indexLines = fileEntries.map(e => JSON.stringify(e)).join('\n');
      writeSecure(path.join(tmpRevDir, 'files.index.jsonl'), indexLines, scope);

      // 3. Write commits.jsonl
      writeSecure(path.join(tmpRevDir, 'commits.jsonl'), commitsJsonl.join('\n'), scope);

      // 4. Write coverage.json
      writeSecure(path.join(tmpRevDir, 'coverage.json'), JSON.stringify(coverageData, null, 2), scope);

      // 5. Write files detail and patch diffs
      const filesDir = path.join(tmpRevDir, 'files');
      fileChangesMap.forEach(({ change, diffContent }, fileId) => {
        const fileSubDir = path.join(filesDir, fileId);
        fs.mkdirSync(fileSubDir, { recursive: true });
        writeSecure(path.join(fileSubDir, 'change.json'), JSON.stringify(change, null, 2), scope);
        writeSecure(path.join(fileSubDir, 'patch.diff'), diffContent, scope);
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
        if (detail) writeSecure(path.join(tmpFilesDir, `${entry.id}.md`), MarkdownFormatter.formatFileDetail(entry, detail), scope);
      });
      fs.rmSync(topFilesDir, { recursive: true, force: true });
      fs.renameSync(tmpFilesDir, topFilesDir);

      writeSecure(path.join(prDir, 'context.md'), MarkdownFormatter.formatContextPack(`${workspace}/${repoSlug}`, fullManifest, commitsJsonl, aiReading, fileEntries, coverageData), scope);
      writeSecure(path.join(prDir, 'files.md'), MarkdownFormatter.formatFilesSummaryList(fileEntries), scope);
      writeSecure(path.join(prDir, 'actions.md'), MarkdownFormatter.formatActionsSummary(coverageData), scope);
      // Top-level manifest.json kept for backward compatibility.
      writeSecure(path.join(prDir, 'manifest.json'), JSON.stringify(fullManifest, null, 2), scope);

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
      writeSecure(path.join(prDir, 'current.json'), JSON.stringify(currentData, null, 2), scope);

      for (const previousPrDir of previousPrDirs ?? []) {
        if (path.resolve(previousPrDir) !== path.resolve(prDir)) {
          this.migratePreviousDirectory(previousPrDir, prDir, revisionId, scope);
        }
      }
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

  private static migratePreviousDirectory(
    previousPrDir: string,
    prDir: string,
    activeRevisionId: string,
    scope: { workspace: string; repoSlug: string; prId: number }
  ): void {
    const previousRevisions = path.join(previousPrDir, 'revisions');
    const revisionsDir = path.join(prDir, 'revisions');
    try {
      if (fs.existsSync(previousRevisions)) {
        for (const entry of fs.readdirSync(previousRevisions, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
          const previousRevision = path.join(previousRevisions, entry.name);
          const targetRevision = path.join(revisionsDir, entry.name);
          if (this.isPlaintextRevision(previousRevision)) continue;
          if (entry.name === activeRevisionId) {
            RevisionValidator.validateOrThrow(targetRevision);
            RevisionValidator.validateOrThrow(previousRevision);
          } else if (fs.existsSync(targetRevision)) {
            if (!secureTreesEqual(previousRevision, targetRevision)) {
              throw new Error('The retained revision does not match its stored destination.');
            }
          } else {
            this.moveRevision(previousRevision, targetRevision, revisionsDir, scope);
          }
        }
      }
      fs.rmSync(previousPrDir, { recursive: true, force: true });
    } catch {
      // The newly published revision is valid; leave any unmigrated encrypted source data in place.
    }
  }

  private static isPlaintextRevision(revisionDir: string): boolean {
    const manifest = path.join(revisionDir, 'manifest.json');
    if (!fs.existsSync(manifest)) return true;
    try {
      readSecure(manifest);
      return false;
    } catch (err) {
      if (err instanceof PlaintextFileError) return true;
      throw err;
    }
  }

  private static moveRevision(
    source: string,
    target: string,
    revisionsDir: string,
    scope: { workspace: string; repoSlug: string; prId: number }
  ): void {
    verifySecureTree(source);
    try {
      fs.renameSync(source, target);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    }

    const stagingRoot = fs.mkdtempSync(path.join(revisionsDir, `.tmp-migrate-${path.basename(source)}-`));
    const stagedRevision = path.join(stagingRoot, path.basename(source));
    try {
      copySecureTree(source, stagedRevision, scope);
      if (!secureTreesEqual(source, stagedRevision)) throw new Error('Copied revision does not match its source.');
      fs.renameSync(stagedRevision, target);
      if (!secureTreesEqual(source, target)) throw new Error('Published revision does not match its source.');
    } finally {
      fs.rmSync(stagingRoot, { recursive: true, force: true });
    }
  }

  /** Keeps the active revision plus the newest KEEP_REVISIONS - 1 others; always drops unencrypted (pre-encryption) ones. */
  private static pruneRevisions(revisionsDir: string, activeRevision: string): void {
    const others = fs.readdirSync(revisionsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== activeRevision)
      .map(e => path.join(revisionsDir, e.name));
    const isPlaintext = (dir: string) => {
      const manifest = path.join(dir, 'manifest.json');
      return !fs.existsSync(manifest) || !isEncryptedFile(manifest);
    };
    const stale = others.filter(isPlaintext);
    const old = others
      .filter(dir => !stale.includes(dir))
      .map(dir => ({ dir, mtime: fs.statSync(dir).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .slice(this.KEEP_REVISIONS - 1)
      .map(e => e.dir);
    for (const dir of [...stale, ...old]) fs.rmSync(dir, { recursive: true, force: true });
  }
}
