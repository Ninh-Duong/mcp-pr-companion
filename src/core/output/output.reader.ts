import fs from 'fs';
import path from 'path';
import { PRManifestV4 } from './schema/manifest.v4.schema.js';
import { FileIndexEntryV4 } from './schema/file_index.v4.schema.js';
import { FileChangeV4 } from './schema/file_change.v4.schema.js';
import { RevisionWriter } from './revision.writer.js';
import { StorePathResolver } from './store-path.resolver.js';
import { ConfigManager } from '../../config/config.manager.js';
import { readSecure, PlaintextFileError } from '../storage/secure-file.js';

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
  /**
   * Decrypted text of an ai-context file, or null when it is missing or still unencrypted
   * (written before encryption: callers treat that as "not synced" and re-sync). Access errors
   * ("No access …") and tampering ("Cannot decrypt …") are thrown, never hidden as "missing".
   */
  static readText(file: string): string | null {
    if (!fs.existsSync(file)) return null;
    try {
      return readSecure(file);
    } catch (err) {
      if (err instanceof PlaintextFileError) return null;
      throw err;
    }
  }

  private static readJson<T>(file: string): T | null {
    const text = this.readText(file);
    return text === null ? null : (JSON.parse(text) as T);
  }

  private static getConfiguredPathOptions(): { company?: string; root?: string } {
    try {
      const config = ConfigManager.loadBase();
      return {
        company: config.ai_context.company,
        root: config.ai_context.root
      };
    } catch {
      return {};
    }
  }

  public static getPROutputDir(
    workspace: string,
    repoSlug: string,
    prId: number,
    company?: string,
    root?: string
  ): string {
    const configured = company !== undefined || root !== undefined
      ? { company, root }
      : this.getConfiguredPathOptions();

    const primaryDir = RevisionWriter.getPROutputDir(
      workspace,
      repoSlug,
      prId,
      configured.company,
      configured.root
    );
    if (fs.existsSync(primaryDir)) {
      return primaryDir;
    }

    if (configured.company) {
      const companylessDir = RevisionWriter.getPROutputDir(workspace, repoSlug, prId, undefined, configured.root);
      if (fs.existsSync(companylessDir)) {
        return companylessDir;
      }
    }

    if (configured.root && configured.root !== StorePathResolver.DEFAULT_ROOT) {
      const defaultRootDir = RevisionWriter.getPROutputDir(
        workspace,
        repoSlug,
        prId,
        undefined,
        StorePathResolver.DEFAULT_ROOT
      );
      if (fs.existsSync(defaultRootDir)) {
        return defaultRootDir;
      }
    }

    return primaryDir;
  }

  static getActiveRevision(
    workspace: string,
    repoSlug: string,
    prId: number
  ): ActiveRevisionResult | null {
    const prDir = this.getPROutputDir(workspace, repoSlug, prId);
    const currentPath = path.join(prDir, 'current.json');

    const current = this.readJson<ActiveRevisionResult['current']>(currentPath);
    if (!current) return null;
    const manifest = this.getManifest(workspace, repoSlug, prId, current.active_revision);
    return manifest ? { current, manifest } : null;
  }

  private static resolveRevisionDir(workspace: string, repoSlug: string, prId: number, revisionId?: string): string | null {
    const prDir = this.getPROutputDir(workspace, repoSlug, prId);
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

    return this.readJson<PRManifestV4>(path.join(revDir, 'manifest.json'));
  }

  static getContextPack(workspace: string, repoSlug: string, prId: number): string | null {
    const prDir = this.getPROutputDir(workspace, repoSlug, prId);
    return this.readText(path.join(prDir, 'context.md'));
  }

  static getFilesSummary(workspace: string, repoSlug: string, prId: number): string | null {
    const prDir = this.getPROutputDir(workspace, repoSlug, prId);
    return this.readText(path.join(prDir, 'files.md'));
  }

  /**
   * Normalizes `12` / `"12"` / `"file_0012"` to `file_0012`. Rejects anything else so
   * caller-supplied ids (MCP tool input) can never escape the PR output directory.
   */
  static normalizeFileId(fileId: string | number): string {
    const raw = String(fileId).trim();
    if (/^\d+$/.test(raw)) return `file_${String(parseInt(raw, 10)).padStart(4, '0')}`;
    if (/^file_\d+$/.test(raw)) return raw;
    throw new Error(`Invalid file_id "${raw}". Expected e.g. "file_0001".`);
  }

  static getFileContext(workspace: string, repoSlug: string, prId: number, fileId: string | number): string | null {
    const prDir = this.getPROutputDir(workspace, repoSlug, prId);
    const normalizedId = this.normalizeFileId(fileId);

    return this.readText(path.join(prDir, 'files', `${normalizedId}.md`));
  }

  static getFileIndex(workspace: string, repoSlug: string, prId: number, revisionId?: string): FileIndexEntryV4[] {
    const revDir = this.resolveRevisionDir(workspace, repoSlug, prId, revisionId);
    if (!revDir) return [];

    const text = this.readText(path.join(revDir, 'files.index.jsonl'));
    return text ? text.split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
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

    const normalizedId = this.normalizeFileId(fileId);

    const changePath = path.join(revDir, 'files', normalizedId, 'change.json');
    const diffPath = path.join(revDir, 'files', normalizedId, 'patch.diff');

    const change = this.readJson<FileChangeV4>(changePath);
    if (!change) return null;
    return { change, diffContent: this.readText(diffPath) ?? undefined };
  }
}
