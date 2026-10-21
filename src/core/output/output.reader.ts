import fs from 'fs';
import path from 'path';
import { PRManifestV4 } from './schema/manifest.v4.schema.js';
import { FileIndexEntryV4 } from './schema/file_index.v4.schema.js';
import { FileChangeV4 } from './schema/file_change.v4.schema.js';
import { RevisionWriter } from './revision.writer.js';
import { StorePathResolver } from './store-path.resolver.js';
import { ConfigManager } from '../../config/config.manager.js';
import { readSecure, PlaintextFileError } from '../storage/secure-file.js';
import { PRStorageStatus, PR_STORAGE_STATUSES } from '../pr-status.js';

export interface ActiveRevisionResult {
  prDir: string;
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
    root?: string,
    status?: PRStorageStatus
  ): string {
    const configured = company !== undefined || root !== undefined
      ? { company, root }
      : this.getConfiguredPathOptions();

    if (status) return RevisionWriter.getPROutputDir(workspace, repoSlug, prId, configured.company, configured.root, status);
    return this.getActiveRevision(workspace, repoSlug, prId)?.prDir ?? RevisionWriter.getPROutputDir(
      workspace,
      repoSlug,
      prId,
      configured.company,
      configured.root
    );
  }

  private static locationOptions(): Array<{ company?: string; root?: string }> {
    const configured = this.getConfiguredPathOptions();
    const options = [configured];
    if (configured.company) options.push({ root: configured.root });
    if (configured.root && configured.root !== StorePathResolver.DEFAULT_ROOT) options.push({ root: StorePathResolver.DEFAULT_ROOT });
    return options.filter((value, index, all) => all.findIndex(other => other.company === value.company && other.root === value.root) === index);
  }

  static getPRDirectories(workspace: string, repoSlug: string, prId: number): string[] {
    return this.locationOptions().flatMap(({ company, root }) =>
      StorePathResolver.getBitbucketPRDirs(workspace, repoSlug, prId, company, root)
    );
  }

  static getRepositoryDirectories(workspace: string, repoSlug: string): string[] {
    return this.locationOptions().map(({ company, root }) =>
      StorePathResolver.getBitbucketRepositoryDir(workspace, repoSlug, company, root)
    );
  }

  static hasPRRevision(workspace: string, repoSlug: string, prId: number): boolean {
    return this.getPRDirectories(workspace, repoSlug, prId).some(dir => fs.existsSync(path.join(dir, 'current.json')));
  }

  static listPRIds(workspace: string, repoSlug: string): number[] {
    const ids = new Set<number>();
    for (const repositoryDir of this.getRepositoryDirectories(workspace, repoSlug)) {
      if (!fs.existsSync(repositoryDir)) continue;
      for (const status of PR_STORAGE_STATUSES) {
        const statusDir = path.join(repositoryDir, status);
        if (!fs.existsSync(statusDir)) continue;
        for (const name of fs.readdirSync(statusDir)) {
          const match = /^pr_(\d+)$/.exec(name);
          if (match) ids.add(Number(match[1]));
        }
      }
      for (const name of fs.readdirSync(repositoryDir)) {
        const match = /^pr_(\d+)$/.exec(name);
        if (match) ids.add(Number(match[1]));
      }
    }
    return [...ids].sort((a, b) => b - a);
  }

  static getActiveRevision(
    workspace: string,
    repoSlug: string,
    prId: number
  ): ActiveRevisionResult | null {
    const matches = this.getPRDirectories(workspace, repoSlug, prId).flatMap((prDir, index) => {
      const current = this.readJson<ActiveRevisionResult['current']>(path.join(prDir, 'current.json'));
      if (!current) return [];
      const manifest = this.readJson<PRManifestV4>(path.join(prDir, 'revisions', current.active_revision, 'manifest.json'));
      return manifest ? [{ prDir, current, manifest, index }] : [];
    });
    matches.sort((a, b) => Date.parse(b.current.updated_at || '') - Date.parse(a.current.updated_at || '') || a.index - b.index);
    const active = matches[0];
    return active ? { prDir: active.prDir, current: active.current, manifest: active.manifest } : null;
  }

  private static resolveRevisionDir(workspace: string, repoSlug: string, prId: number, revisionId?: string): string | null {
    const active = this.getActiveRevision(workspace, repoSlug, prId);
    const directories = revisionId
      ? this.getPRDirectories(workspace, repoSlug, prId)
      : active ? [active.prDir] : [];
    let targetRev = revisionId;

    if (!targetRev) {
      targetRev = active?.current?.active_revision;
    }

    if (!targetRev) {
      return null;
    }

    for (const prDir of directories) {
      const revDir = path.join(prDir, 'revisions', targetRev);
      if (fs.existsSync(revDir)) return revDir;
    }
    return null;
  }

  static getManifest(workspace: string, repoSlug: string, prId: number, revisionId?: string): PRManifestV4 | null {
    const revDir = this.resolveRevisionDir(workspace, repoSlug, prId, revisionId);
    if (!revDir) return null;

    return this.readJson<PRManifestV4>(path.join(revDir, 'manifest.json'));
  }

  static getContextPack(workspace: string, repoSlug: string, prId: number): string | null {
    const active = this.getActiveRevision(workspace, repoSlug, prId);
    return active ? this.readText(path.join(active.prDir, 'context.md')) : null;
  }

  static getFilesSummary(workspace: string, repoSlug: string, prId: number): string | null {
    const active = this.getActiveRevision(workspace, repoSlug, prId);
    return active ? this.readText(path.join(active.prDir, 'files.md')) : null;
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
    const active = this.getActiveRevision(workspace, repoSlug, prId);
    if (!active) return null;
    const normalizedId = this.normalizeFileId(fileId);
    return this.readText(path.join(active.prDir, 'files', `${normalizedId}.md`));
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
