import fs from 'fs';
import path from 'path';
import { AtomicWriter } from './atomic.writer.js';
import { CacheIndex, CacheIndexEntry } from './cache.index.js';
import { RawPRRevision } from '../bitbucket/bitbucket.types.js';
import { ConfigManager } from '../../config/config.manager.js';
import { ModuleClassifier } from '../analyzer/module.classifier.js';
import { ASTExtractor } from '../analyzer/ast.extractor.js';
import { GitParser } from '../git/git.parser.js';

export interface PRManifest {
  schema_version: string;
  cache_key: string;
  pr: {
    id: number;
    ticket_id: string;
    title: string;
    source_branch: string;
    target_branch: string;
    source_hash: string;
    destination_hash: string;
    author: string;
  };
  stats: {
    files: number;
    additions: number;
    deletions: number;
  };
  modules: Array<{
    name: string;
    file_ids: number[];
  }>;
  files: Array<{
    id: number;
    path: string;
    status: string;
    additions: number;
    deletions: number;
    generated: boolean;
    risk_tags: string[];
  }>;
  coverage: {
    metadata: string;
    commits: string;
    diffstat: string;
    diff: string;
  };
  warnings: string[];
}

export interface PRFileDetail {
  file_id: number;
  path: string;
  highlights: string[];
  risks: string[];
}

export class DataStore {
  private static baseDataDir = path.resolve(process.cwd(), '.mcp-pr-companion', 'data', 'bitbucket');

  static getPRDir(workspace: string, repoSlug: string, prId: number): string {
    return path.join(this.baseDataDir, workspace.toLowerCase(), repoSlug.toLowerCase(), `pr-${prId}`);
  }

  static getRevisionDir(workspace: string, repoSlug: string, prId: number, sourceHash: string): string {
    return path.join(this.getPRDir(workspace, repoSlug, prId), 'revisions', sourceHash);
  }

  /**
   * Checks if current.json exists and points to an active complete revision with matching hashes.
   */
  static getActiveRevision(workspace: string, repoSlug: string, prId: number): { current: any; manifest?: PRManifest } | null {
    const prDir = this.getPRDir(workspace, repoSlug, prId);
    const currentFile = path.join(prDir, 'current.json');

    if (!fs.existsSync(currentFile)) {
      return null;
    }

    try {
      const current = JSON.parse(fs.readFileSync(currentFile, 'utf-8'));
      const manifestFile = path.join(prDir, current.revision_path, 'derived', 'manifest.json');

      if (fs.existsSync(manifestFile)) {
        const manifest: PRManifest = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
        return { current, manifest };
      }
    } catch {
      // Ignore read error
    }

    return null;
  }

  /**
   * Persists raw collection data and generates derived agent-ready manifest and file details.
   */
  static saveRevision(
    workspace: string,
    repoSlug: string,
    prId: number,
    rawRev: RawPRRevision
  ): { cacheKey: string; manifest: PRManifest } {
    const config = ConfigManager.loadBase();
    const prDir = this.getPRDir(workspace, repoSlug, prId);
    const revDir = this.getRevisionDir(workspace, repoSlug, prId, rawRev.sourceHash);

    const rawDir = path.join(revDir, 'raw');
    const derivedDir = path.join(revDir, 'derived');
    const filesDir = path.join(derivedDir, 'files');

    // 1. Save Raw Data
    AtomicWriter.writeFileSync(path.join(rawDir, 'metadata.json'), JSON.stringify(rawRev.metadata, null, 2));
    AtomicWriter.writeFileSync(path.join(rawDir, 'commits.json'), JSON.stringify(rawRev.commits, null, 2));
    AtomicWriter.writeFileSync(path.join(rawDir, 'diffstat.json'), JSON.stringify(rawRev.diffstat, null, 2));

    if (rawRev.rawDiff) {
      AtomicWriter.writeGzipSync(path.join(rawDir, 'diff.patch.gz'), rawRev.rawDiff);
    }

    // 2. Generate Agent-Ready Derived Data
    const prData = rawRev.metadata || {};
    const title = prData.title || '';
    const sourceBranch = prData.source?.branch?.name || '';
    const targetBranch = prData.destination?.branch?.name || '';
    const author = prData.author?.display_name || prData.author?.username || 'unknown';

    const commitSummary: string[] = (rawRev.commits || [])
      .map((c: any) => (c.message || '').split('\n')[0].trim())
      .filter(Boolean);

    const ticketId = GitParser.extractTicketId(sourceBranch, commitSummary, config.ticket_prefix);

    let totalAdditions = 0;
    let totalDeletions = 0;
    const fileEntries: PRManifest['files'] = [];
    const moduleMap = new Map<string, number[]>();

    const changedFiles: string[] = [];
    (rawRev.diffstat || []).forEach((item: any, idx: number) => {
      const fileId = idx + 1;
      const filePath = item.new?.path || item.old?.path || `file_${fileId}`;
      changedFiles.push(filePath);
      const additions = item.lines_added || 0;
      const deletions = item.lines_removed || 0;
      totalAdditions += additions;
      totalDeletions += deletions;

      const isGenerated = filePath.endsWith('.designer.cs') || filePath.includes('/migrations/') || filePath.endsWith('.g.cs');
      const riskTags: string[] = [];
      if (filePath.includes('Controller')) riskTags.push('public_api');
      if (filePath.includes('Migration') || filePath.endsWith('.sql')) riskTags.push('database_schema');
      if (filePath.endsWith('.proto')) riskTags.push('grpc_contract');

      fileEntries.push({
        id: fileId,
        path: filePath,
        status: item.status || 'modified',
        additions,
        deletions,
        generated: isGenerated,
        risk_tags: riskTags
      });
    });

    const categorizedFiles = ModuleClassifier.classify(changedFiles, config.module_rules);
    const fileHighlights = ASTExtractor.extractHighlights(changedFiles, rawRev.rawDiff);

    for (const [moduleName, filePaths] of Object.entries(categorizedFiles)) {
      const fileIds: number[] = [];
      for (const p of filePaths) {
        const found = fileEntries.find(fe => fe.path === p);
        if (found) fileIds.push(found.id);
      }
      if (fileIds.length > 0) {
        moduleMap.set(moduleName, fileIds);
      }
    }

    const cacheKey = CacheIndex.generateCacheKey(
      workspace,
      repoSlug,
      prId,
      rawRev.sourceHash,
      rawRev.destinationHash,
      config
    );

    const manifest: PRManifest = {
      schema_version: '2.0',
      cache_key: cacheKey,
      pr: {
        id: prId,
        ticket_id: ticketId,
        title,
        source_branch: sourceBranch,
        target_branch: targetBranch,
        source_hash: rawRev.sourceHash,
        destination_hash: rawRev.destinationHash,
        author
      },
      stats: {
        files: fileEntries.length,
        additions: totalAdditions,
        deletions: totalDeletions
      },
      modules: Array.from(moduleMap.entries()).map(([name, file_ids]) => ({ name, file_ids })),
      files: fileEntries,
      coverage: rawRev.coverage,
      warnings: rawRev.warnings
    };

    // Save manifest.json
    AtomicWriter.writeFileSync(path.join(derivedDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

    // Save individual compressed file details
    for (const fileEntry of fileEntries) {
      const fileDetail: PRFileDetail = {
        file_id: fileEntry.id,
        path: fileEntry.path,
        highlights: fileHighlights[fileEntry.path] || [],
        risks: fileEntry.risk_tags
      };

      const fileIdStr = String(fileEntry.id).padStart(4, '0');
      AtomicWriter.writeGzipSync(path.join(filesDir, `${fileIdStr}.json.gz`), JSON.stringify(fileDetail, null, 2));
    }

    // 3. Update current.json
    const relativeRevPath = path.relative(prDir, revDir).replace(/\\/g, '/');
    const currentData = {
      schema_version: 1,
      pr_id: prId,
      source_hash: rawRev.sourceHash,
      destination_hash: rawRev.destinationHash,
      revision_path: relativeRevPath,
      last_checked_at: new Date().toISOString(),
      status: 'complete'
    };
    AtomicWriter.writeFileSync(path.join(prDir, 'current.json'), JSON.stringify(currentData, null, 2));

    // 4. Update CacheIndex
    CacheIndex.updateEntry({
      cacheKey,
      provider: 'bitbucket-cloud',
      workspace,
      repoSlug,
      prId,
      sourceHash: rawRev.sourceHash,
      destinationHash: rawRev.destinationHash,
      revisionPath: relativeRevPath,
      lastCheckedAt: new Date().toISOString(),
      status: 'complete'
    });

    return { cacheKey, manifest };
  }

  /**
   * Reads compressed file details for a specific file_id.
   */
  static getFileDetail(workspace: string, repoSlug: string, prId: number, fileId: number): PRFileDetail | null {
    const active = this.getActiveRevision(workspace, repoSlug, prId);
    if (!active) return null;

    const prDir = this.getPRDir(workspace, repoSlug, prId);
    const fileIdStr = String(fileId).padStart(4, '0');
    const filePath = path.join(prDir, active.current.revision_path, 'derived', 'files', `${fileIdStr}.json.gz`);

    if (!fs.existsSync(filePath)) return null;

    try {
      const rawJson = AtomicWriter.readGzipSync(filePath);
      return JSON.parse(rawJson);
    } catch {
      return null;
    }
  }
}
