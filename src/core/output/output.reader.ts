import fs from 'fs';
import path from 'path';
import { PRManifestV4 } from './schema/manifest.v4.schema.js';
import { FileIndexEntryV4 } from './schema/file_index.v4.schema.js';
import { FileChangeV4 } from './schema/file_change.v4.schema.js';
import { RevisionWriter } from './revision.writer.js';

export interface ActiveRevisionResult {
  current: {
    active_revision: string;
    updated_at?: string;
    generated_at?: string;
    source_commit?: string;
    source_hash?: string;
    target_commit?: string;
    destination_hash?: string;
  };
  manifest: PRManifestV4 | null;
}

export class OutputReader {
  static getActiveRevision(
    workspace: string,
    repoSlug: string,
    prId: number
  ): ActiveRevisionResult | null {
    const prDir = RevisionWriter.getPROutputDir(workspace, repoSlug, prId);
    const currentPath = path.join(prDir, 'current.json');

    if (!fs.existsSync(currentPath)) {
      return null;
    }

    try {
      const current = JSON.parse(fs.readFileSync(currentPath, 'utf-8'));
      const manifest = this.getManifest(workspace, repoSlug, prId, current.active_revision);
      return { current, manifest };
    } catch {
      return null;
    }
  }

  private static resolveRevisionDir(workspace: string, repoSlug: string, prId: number, revisionId?: string): string | null {
    const prDir = RevisionWriter.getPROutputDir(workspace, repoSlug, prId);
    let targetRev = revisionId;

    if (!targetRev) {
      const active = this.getActiveRevision(workspace, repoSlug, prId);
      targetRev = active?.current?.active_revision;
    }

    if (!targetRev) {
      return null;
    }

    const revDir = path.join(prDir, 'revisions', targetRev);
    return fs.existsSync(revDir) ? revDir : null;
  }

  static getManifest(workspace: string, repoSlug: string, prId: number, revisionId?: string): PRManifestV4 | null {
    const revDir = this.resolveRevisionDir(workspace, repoSlug, prId, revisionId);
    if (!revDir) return null;

    const manifestPath = path.join(revDir, 'manifest.json');
    if (!fs.existsSync(manifestPath)) return null;

    try {
      return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as PRManifestV4;
    } catch {
      return null;
    }
  }

  static getFileIndex(workspace: string, repoSlug: string, prId: number, revisionId?: string): FileIndexEntryV4[] {
    const revDir = this.resolveRevisionDir(workspace, repoSlug, prId, revisionId);
    if (!revDir) return [];

    const indexPath = path.join(revDir, 'files.index.jsonl');
    if (!fs.existsSync(indexPath)) return [];

    try {
      const lines = fs.readFileSync(indexPath, 'utf-8').split('\n').filter(Boolean);
      return lines.map(line => JSON.parse(line));
    } catch {
      return [];
    }
  }

  static getFileChange(
    workspace: string,
    repoSlug: string,
    prId: number,
    fileId: string | number,
    revisionId?: string
  ): { change: FileChangeV4; diffContent?: string } | null {
    const revDir = this.resolveRevisionDir(workspace, repoSlug, prId, revisionId);
    if (!revDir) return null;

    let normalizedId = String(fileId);
    if (typeof fileId === 'number' || /^\d+$/.test(normalizedId)) {
      normalizedId = `file_${String(fileId).padStart(4, '0')}`;
    }

    const changePath = path.join(revDir, 'files', normalizedId, 'change.json');
    const diffPath = path.join(revDir, 'files', normalizedId, 'patch.diff');

    if (!fs.existsSync(changePath)) return null;

    try {
      const change = JSON.parse(fs.readFileSync(changePath, 'utf-8')) as FileChangeV4;
      let diffContent: string | undefined;
      if (fs.existsSync(diffPath)) {
        diffContent = fs.readFileSync(diffPath, 'utf-8');
      }
      return { change, diffContent };
    } catch {
      return null;
    }
  }
}
