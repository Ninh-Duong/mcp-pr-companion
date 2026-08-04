import fs from 'fs';
import path from 'path';
import { PRManifestV4 } from './schema/manifest.v4.schema.js';
import { FileIndexEntryV4 } from './schema/file_index.v4.schema.js';
import { FileChangeV4 } from './schema/file_change.v4.schema.js';
import { PRCoverageV4 } from './schema/coverage.v4.schema.js';
import { RevisionValidator } from './revision.validator.js';
import { TextNormalizer } from '../../utils/text.normalizer.js';

export interface WriteRevisionOptions {
  workspace: string;
  repoSlug: string;
  prId: number;
  sourceHash: string;
  destinationHash: string;
  manifestData: Omit<PRManifestV4, 'schema_version'>;
  fileEntries: FileIndexEntryV4[];
  fileChangesMap: Map<string, { change: FileChangeV4; diffContent: string }>;
  commitsJsonl: string[];
  coverageData: PRCoverageV4;
  provider?: string;
}

export class RevisionWriter {
  private static baseOutputDir = path.resolve(process.cwd(), 'output');

  static getPROutputDir(workspace: string, repoSlug: string, prId: number): string {
    return path.join(this.baseOutputDir, workspace, repoSlug, `pr_${prId}`);
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
    provider: string = 'bitbucket'
  ): { revisionId: string; manifest: PRManifestV4; prDir: string; revisionDir: string } {
    const prDir = this.getPROutputDir(workspace, repoSlug, prId);
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

      const fullManifest: PRManifestV4 = {
        schema_version: '4.0',
        ...manifestData,
        title: normalizedTitle.text,
        description: normalizedDesc.text,
        description_meta: {
          mode: normalizedDesc.isNormalized ? 'normalized' : 'raw'
        },
        provenance: {
          generated_at: nowIso,
          provider: provider,
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

      // 7. Update current.json active pointer ONLY AFTER validation passes
      const currentJsonPath = path.join(prDir, 'current.json');
      const currentData = {
        active_revision: revisionId,
        updated_at: nowIso,
        generated_at: nowIso,
        source_commit: sourceHash,
        source_hash: sourceHash,
        target_commit: destinationHash,
        destination_hash: destinationHash
      };
      fs.writeFileSync(currentJsonPath, JSON.stringify(currentData, null, 2), 'utf-8');

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
}
