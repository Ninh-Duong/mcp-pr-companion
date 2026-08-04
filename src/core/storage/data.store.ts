import fs from 'fs';
import path from 'path';
import { AtomicWriter } from './atomic.writer.js';
import { CacheIndex } from './cache.index.js';
import { RawPRRevision } from '../bitbucket/bitbucket.types.js';
import { ConfigManager } from '../../config/config.manager.js';
import { GitParser } from '../git/git.parser.js';
import { OpaqueIDGenerator } from './opaque.id.js';
import { StableSerializer } from './stable.serializer.js';
import { PRManifestV3 } from '../privacy/manifest.v3.schema.js';
import { PRFileDetailV3 } from '../privacy/file_detail.v3.schema.js';
import { RedactionTracker } from '../privacy/redaction.report.js';
import { PIISanitizer } from '../privacy/pii.sanitizer.js';
import { SecretScanner } from '../privacy/secret.scanner.js';
import { PathSanitizer } from '../privacy/path.sanitizer.js';
import { URLSanitizer } from '../privacy/url.sanitizer.js';
import { SensitiveFilePolicy } from '../analyzer/sensitive.file.policy.js';
import { BitbucketAllowlistProjector } from '../bitbucket/bitbucket.allowlist.js';

export class DataStore {
  private static baseDataDir = path.resolve(process.cwd(), '.mcp-pr-companion', 'data', 'repositories');

  static getPRDir(workspace: string, repoSlug: string, prId: number): string {
    const repoId = OpaqueIDGenerator.getRepositoryID(workspace, repoSlug);
    return path.join(this.baseDataDir, repoId, `pr_${prId}`);
  }

  static getRevisionDir(workspace: string, repoSlug: string, prId: number, sourceHash: string, destinationHash: string): string {
    const revId = OpaqueIDGenerator.getRevisionID(sourceHash, destinationHash);
    return path.join(this.getPRDir(workspace, repoSlug, prId), 'revisions', revId);
  }

  /**
   * Checks if current.json exists and points to an active complete revision.
   */
  static getActiveRevision(workspace: string, repoSlug: string, prId: number): { current: any; manifest?: PRManifestV3 } | null {
    const prDir = this.getPRDir(workspace, repoSlug, prId);
    const currentFile = path.join(prDir, 'current.json');

    if (!fs.existsSync(currentFile)) {
      return null;
    }

    try {
      const current = JSON.parse(fs.readFileSync(currentFile, 'utf-8'));
      const manifestFile = path.join(prDir, current.revision_path, 'manifest.json');

      if (fs.existsSync(manifestFile)) {
        const manifest: PRManifestV3 = JSON.parse(fs.readFileSync(manifestFile, 'utf-8'));
        return { current, manifest };
      }
    } catch {
      // Ignore read error
    }

    return null;
  }

  /**
   * Persists Schema v3.0 agent manifest and compressed file details with strict PII & secret redaction.
   */
  static saveRevision(
    workspace: string,
    repoSlug: string,
    prId: number,
    rawRev: RawPRRevision,
    strategy: 'overwrite' | 'new_version' = 'overwrite'
  ): { cacheKey: string; manifest: PRManifestV3 } {
    const config = ConfigManager.loadBase();
    const privacy = config.privacy;
    const tracker = new RedactionTracker();

    const repoId = OpaqueIDGenerator.getRepositoryID(workspace, repoSlug);
    const baseRevId = OpaqueIDGenerator.getRevisionID(rawRev.sourceHash, rawRev.destinationHash);
    const revId = strategy === 'new_version' ? `${baseRevId}_v${Date.now()}` : baseRevId;
    const prDir = this.getPRDir(workspace, repoSlug, prId);
    const revDir = path.join(prDir, 'revisions', revId);
    const filesDir = path.join(revDir, 'files');

    // 1. Allowlist projection from raw response
    const projectedMeta = BitbucketAllowlistProjector.projectMetadata(rawRev.metadata, privacy.remove_author);
    const projectedCommits = BitbucketAllowlistProjector.projectCommits(rawRev.commits, privacy.max_commit_subjects);
    const projectedDiffstat = BitbucketAllowlistProjector.projectDiffstat(rawRev.diffstat);

    // 2. Sanitize Title & Description & Commits
    const sanitizedTitle = SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(projectedMeta.title, tracker), tracker);
    const sanitizedDesc = SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(projectedMeta.description, tracker), tracker);

    const commitSubjects: string[] = projectedCommits.map(c =>
      SecretScanner.scanAndRedact(PIISanitizer.sanitizeText(c.subject, tracker), tracker)
    );

    const ticketId = GitParser.extractTicketId(
      projectedMeta.source.branch.name,
      commitSubjects,
      config.ticket_prefix
    );

    // 3. Process Files & Build Manifest + File Details
    let totalAdditions = 0;
    let totalDeletions = 0;
    const manifestFiles: PRManifestV3['files'] = [];
    const fileDetails: PRFileDetailV3[] = [];

    let hasFunctionalChange = false;
    let containsCommentsOnly = true;

    projectedDiffstat.forEach((item, idx) => {
      const fileIndex = idx + 1;
      const fileIdStr = `file_${String(fileIndex).padStart(4, '0')}`;
      const originalPath = item.new_path || item.old_path || `file_${fileIndex}`;

      totalAdditions += item.lines_added;
      totalDeletions += item.lines_removed;

      const isSensitive = SensitiveFilePolicy.isSensitiveFile(originalPath);
      const riskTags: string[] = [];

      if (isSensitive) {
        riskTags.push('sensitive_configuration_changed');
        tracker.recordOmittedFile();
      }
      if (originalPath.includes('Controller')) riskTags.push('public_api');
      if (originalPath.includes('Migration') || originalPath.endsWith('.sql')) riskTags.push('database_schema');
      if (originalPath.endsWith('.proto')) riskTags.push('grpc_contract');

      const sanitizedPathValue = PathSanitizer.sanitize(originalPath, privacy.file_path_mode, fileIdStr);

      const changeTypes: string[] = [];
      if (item.lines_added > 0 && item.lines_removed === 0) changeTypes.push('added_lines');
      else if (item.lines_removed > 0 && item.lines_added === 0) changeTypes.push('removed_lines');
      else changeTypes.push('modified_lines');

      if (!isSensitive) {
        hasFunctionalChange = true;
        containsCommentsOnly = false;
      }

      manifestFiles.push({
        id: fileIdStr,
        category: this.getCategoryForPath(originalPath),
        status: item.status,
        change_types: changeTypes,
        risk_tags: riskTags
      });

      // Build File Detail
      const fileDetail: PRFileDetailV3 = {
        schema_version: '3.0',
        document_type: 'pr_file_detail',
        file_id: fileIdStr,
        path: {
          mode: privacy.file_path_mode,
          value: sanitizedPathValue
        },
        language: this.getLanguageForPath(originalPath),
        status: item.status,
        stats: {
          additions: item.lines_added,
          deletions: item.lines_removed
        },
        symbols: [],
        changes: isSensitive
          ? []
          : [
              {
                kind: changeTypes[0] || 'modified',
                functional_change: !isSensitive
              }
            ],
        risk_tags: riskTags,
        content_omitted: isSensitive ? true : undefined,
        redaction: {
          content_modified: true,
          reasons: isSensitive ? ['sensitive_file_content_omitted'] : ['secret_scanned']
        }
      };

      fileDetails.push(fileDetail);
    });

    const changeType = containsCommentsOnly
      ? 'comment_only'
      : manifestFiles.some(f => f.risk_tags.includes('database_schema'))
      ? 'database_migration'
      : manifestFiles.some(f => f.risk_tags.includes('grpc_contract'))
      ? 'grpc_contract'
      : 'functional_logic';

    const cacheKey = CacheIndex.generateCacheKey(
      workspace,
      repoSlug,
      prId,
      rawRev.sourceHash,
      rawRev.destinationHash,
      config
    );

    const redactionReport = tracker.getReport(privacy.mode);

    const manifest: PRManifestV3 = {
      schema_version: '3.0',
      document_type: 'pr_manifest',
      repository_id: repoId,
      pr: {
        id: prId,
        ticket_id: ticketId === 'N/A' ? null : ticketId,
        title: sanitizedTitle,
        state: projectedMeta.state,
        draft: Boolean(projectedMeta.draft)
      },
      revision: {
        id: revId
      },
      change_summary: {
        type: changeType,
        functional_change: hasFunctionalChange,
        risk_level: manifestFiles.some(f => f.risk_tags.includes('sensitive_configuration_changed')) ? 'high' : 'low',
        confidence: 0.98
      },
      stats: {
        commits: commitSubjects.length,
        files: manifestFiles.length,
        additions: totalAdditions,
        deletions: totalDeletions
      },
      files: manifestFiles,
      coverage: {
        metadata: rawRev.coverage.metadata,
        commits: rawRev.coverage.commits,
        diffstat: rawRev.coverage.diffstat,
        diff: rawRev.coverage.diff,
        comments: 'not_fetched',
        ci: 'not_fetched'
      },
      redaction: {
        mode: redactionReport.mode,
        pii_removed: redactionReport.pii_removed,
        secrets_scanned: redactionReport.secrets_scanned,
        redacted_values: redactionReport.redacted_values
      },
      generated_at: new Date().toISOString()
    };

    // 4. Always save manifest.json and compressed file details to disk
    const manifestPath = path.join(revDir, 'manifest.json');
    AtomicWriter.writeFileSync(manifestPath, StableSerializer.stringify(manifest));

    for (const fileDetail of fileDetails) {
      const filePath = path.join(filesDir, `${fileDetail.file_id}.json.gz`);
      AtomicWriter.writeGzipSync(filePath, StableSerializer.stringify(fileDetail));
    }

    // 5. Update current.json
    const relativeRevPath = path.relative(prDir, revDir).replace(/\\/g, '/');
    const currentData = {
      schema_version: 3,
      pr_id: prId,
      repository_id: repoId,
      revision_id: revId,
      revision_path: relativeRevPath,
      last_checked_at: new Date().toISOString(),
      status: 'complete'
    };
    AtomicWriter.writeFileSync(path.join(prDir, 'current.json'), JSON.stringify(currentData, null, 2));

    // 6. Direct Export to output/ directory (Always enabled)
    DataStore.exportRawToOutput(workspace, repoSlug, prId, rawRev, ticketId, manifest);

    return { cacheKey, manifest };
  }

  /**
   * Exports PR data JSON directly to ./output/ directory.
   */
  static exportRawToOutput(
    workspace: string,
    repoSlug: string,
    prId: number,
    rawRev: RawPRRevision,
    ticketId?: string,
    manifest?: any
  ): string {
    const outputDir = path.resolve(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const ticketStr = ticketId && ticketId !== 'N/A' ? `${ticketId}_` : '';
    const safeWorkspace = workspace.toLowerCase();
    const safeRepo = repoSlug.toLowerCase();
    const fileName = `pr_${ticketStr}${safeWorkspace}_${safeRepo}_pr${prId}.json`;
    const filePath = path.join(outputDir, fileName);

    const exportData = {
      workspace,
      repoSlug,
      prId,
      ticket_id: ticketId || 'N/A',
      manifest,
      source_hash: rawRev.sourceHash,
      destination_hash: rawRev.destinationHash,
      metadata: rawRev.metadata,
      commits: rawRev.commits,
      diffstat: rawRev.diffstat,
      raw_diff: rawRev.rawDiff,
      coverage: rawRev.coverage,
      warnings: rawRev.warnings,
      exported_at: new Date().toISOString()
    };

    AtomicWriter.writeFileSync(filePath, JSON.stringify(exportData, null, 2));
    return filePath;
  }

  /**
   * Reads compressed file details for a specific file_id.
   */
  static getFileDetail(workspace: string, repoSlug: string, prId: number, fileIdStr: string | number): PRFileDetailV3 | null {
    const active = this.getActiveRevision(workspace, repoSlug, prId);
    if (!active) return null;

    const formattedId = typeof fileIdStr === 'number' ? `file_${String(fileIdStr).padStart(4, '0')}` : fileIdStr;
    const prDir = this.getPRDir(workspace, repoSlug, prId);
    const filePath = path.join(prDir, active.current.revision_path, 'files', `${formattedId}.json.gz`);

    if (!fs.existsSync(filePath)) return null;

    try {
      const rawJson = AtomicWriter.readGzipSync(filePath);
      return JSON.parse(rawJson);
    } catch {
      return null;
    }
  }

  private static getCategoryForPath(filePath: string): string {
    const lower = filePath.toLowerCase();
    if (lower.includes('controller')) return 'api_controller';
    if (lower.includes('service') || lower.includes('usecase')) return 'business_logic';
    if (lower.includes('migration') || lower.endsWith('.sql')) return 'database_schema';
    if (lower.endsWith('.proto')) return 'grpc_contract';
    if (lower.includes('test') || lower.includes('spec')) return 'unit_test';
    return 'general';
  }

  private static getLanguageForPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.cs': return 'csharp';
      case '.ts': return 'typescript';
      case '.js': return 'javascript';
      case '.go': return 'go';
      case '.py': return 'python';
      case '.sql': return 'sql';
      case '.proto': return 'protobuf';
      case '.json': return 'json';
      case '.yml': case '.yaml': return 'yaml';
      default: return 'text';
    }
  }
}
