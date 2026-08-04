import fs from 'fs';
import path from 'path';
import { RawPRRevision } from '../bitbucket/bitbucket.types.js';
import { ConfigManager } from '../../config/config.manager.js';
import { GitParser } from '../git/git.parser.js';
import { OpaqueIDGenerator } from './opaque.id.js';
import { RedactionTracker } from '../privacy/redaction.report.js';
import { PIISanitizer } from '../privacy/pii.sanitizer.js';
import { SecretScanner } from '../privacy/secret.scanner.js';
import { PathSanitizer } from '../privacy/path.sanitizer.js';
import { SensitiveFilePolicy } from '../analyzer/sensitive.file.policy.js';
import { BitbucketAllowlistProjector } from '../bitbucket/bitbucket.allowlist.js';
import { DiffParser } from '../analyzer/diff.parser.js';
import { ChangeClassifier, ChangeKind } from '../analyzer/change.classifier.js';
import { RiskAnalyzer, RiskLevel } from '../analyzer/risk.analyzer.js';
import { SymbolExtractor } from '../analyzer/symbol.extractor.js';
import { RevisionWriter } from '../output/revision.writer.js';
import { OutputReader } from '../output/output.reader.js';
import { PRManifestV4 } from '../output/schema/manifest.v4.schema.js';
import { FileIndexEntryV4 } from '../output/schema/file_index.v4.schema.js';
import { FileChangeV4 } from '../output/schema/file_change.v4.schema.js';
import { PRCoverageV4 } from '../output/schema/coverage.v4.schema.js';

export class DataStore {
  private static rawDataDir = path.resolve(process.cwd(), '.mcp-pr-companion', 'data', 'raw');

  static getActiveRevision(workspace: string, repoSlug: string, prId: number) {
    return OutputReader.getActiveRevision(workspace, repoSlug, prId);
  }

  static getFileDetail(workspace: string, repoSlug: string, prId: number, fileId: string | number) {
    const normalizedId = typeof fileId === 'number' ? `file_${String(fileId).padStart(4, '0')}` : fileId;
    return OutputReader.getFileChange(workspace, repoSlug, prId, normalizedId);
  }

  /**
   * Persists Raw Bitbucket payload internally (debug/retention only)
   * and generates Agent-Optimized Output Schema v4.
   */
  static saveRevision(
    workspace: string,
    repoSlug: string,
    prId: number,
    rawRev: RawPRRevision
  ): { cacheKey: string; manifest: PRManifestV4 } {
    const config = ConfigManager.loadBase();
    const privacy = config.privacy;
    const tracker = new RedactionTracker();

    // 1. Save Internal Raw Cache (For debugging, never exposed to MCP / agent output)
    const rawRepoDir = path.join(this.rawDataDir, OpaqueIDGenerator.getRepositoryID(workspace, repoSlug), `pr_${prId}`);
    fs.mkdirSync(rawRepoDir, { recursive: true });
    fs.writeFileSync(
      path.join(rawRepoDir, `raw_rev_${OpaqueIDGenerator.getRevisionID(rawRev.sourceHash, rawRev.destinationHash).substring(0, 12)}.json`),
      JSON.stringify(rawRev, null, 2),
      'utf-8'
    );

    // 2. Allowlist projection from raw response
    const projectedMeta = BitbucketAllowlistProjector.projectMetadata(rawRev.metadata, privacy.remove_author);
    const projectedCommits = BitbucketAllowlistProjector.projectCommits(rawRev.commits, privacy.max_commit_subjects);
    const projectedDiffstat = BitbucketAllowlistProjector.projectDiffstat(rawRev.diffstat);

    // 3. Sanitize Title & Description & Commits
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

    // 4. Parse unified diff
    const parsedDiff = DiffParser.parse(rawRev.rawDiff || '');

    // 5. Process Files & Build V4 Index & Changes
    let totalAdditions = 0;
    let totalDeletions = 0;

    const fileEntries: FileIndexEntryV4[] = [];
    const fileChangesMap = new Map<string, { change: FileChangeV4; diffContent: string }>();

    const kindCounts: Record<string, number> = {};
    const allRiskTagsSet = new Set<string>();
    const importantFileIds: string[] = [];
    let riskyFilesCount = 0;

    projectedDiffstat.forEach((item, idx) => {
      const fileIndex = idx + 1;
      const fileIdStr = `file_${String(fileIndex).padStart(4, '0')}`;
      const originalPath = item.new_path || item.old_path || `file_${fileIndex}`;

      totalAdditions += item.lines_added;
      totalDeletions += item.lines_removed;

      const isSensitive = SensitiveFilePolicy.isSensitiveFile(originalPath);
      if (isSensitive) tracker.recordOmittedFile();

      // Find parsed diff file matching this path
      const matchedDiff = parsedDiff.files.find(f => f.newPath === originalPath || f.oldPath === originalPath) || {
        oldPath: item.old_path || null,
        newPath: item.new_path || originalPath,
        status: item.status as any,
        isBinary: false,
        additions: item.lines_added,
        deletions: item.lines_removed,
        hunks: [],
        headerLines: []
      };

      const classification = ChangeClassifier.classify(matchedDiff);
      const risk = RiskAnalyzer.analyze(matchedDiff, classification);
      const symbols = SymbolExtractor.extractSymbols(matchedDiff, classification.kind === 'comment_only');

      if (isSensitive) {
        risk.tags.push('sensitive_configuration');
        risk.level = 'high';
        risk.evidence.push('File contains sensitive security configuration');
      }

      kindCounts[classification.kind] = (kindCounts[classification.kind] || 0) + 1;
      risk.tags.forEach(t => allRiskTagsSet.add(t));
      if (risk.level === 'high' || risk.level === 'critical') {
        riskyFilesCount++;
        importantFileIds.push(fileIdStr);
      }

      const sanitizedPath = PathSanitizer.sanitize(originalPath, privacy.file_path_mode, fileIdStr);

      fileEntries.push({
        id: fileIdStr,
        path: sanitizedPath,
        old_path: item.old_path ? PathSanitizer.sanitize(item.old_path, privacy.file_path_mode, fileIdStr) : null,
        language: this.getLanguageForPath(originalPath),
        status: item.status as any,
        additions: item.lines_added,
        deletions: item.lines_removed,
        change_kind: classification.kind,
        risk_tags: risk.tags,
        detail_ref: `files/${fileIdStr}/change.json`
      });

      // Construct file patch.diff text
      let patchDiff = matchedDiff.headerLines.join('\n') + '\n';
      for (const hunk of matchedDiff.hunks) {
        patchDiff += hunk.header + '\n';
        for (const line of hunk.lines) {
          const prefix = line.type === 'add' ? '+' : line.type === 'delete' ? '-' : ' ';
          patchDiff += prefix + line.content + '\n';
        }
      }
      patchDiff = SecretScanner.scanAndRedact(patchDiff, tracker);

      const fileChange: FileChangeV4 = {
        schema_version: '4.0',
        file_id: fileIdStr,
        classification: {
          kind: classification.kind,
          functional_change: classification.functionalChange,
          confidence: classification.confidence,
          evidence: classification.evidence
        },
        symbols,
        risk,
        patch_ref: 'patch.diff',
        context_ref: null,
        redaction_result: {
          scanned: true,
          content_modified: isSensitive
        }
      };

      fileChangesMap.set(fileIdStr, { change: fileChange, diffContent: patchDiff });
    });

    // Primary Kind Calculation
    let primaryKind = 'functional_logic';
    let maxCount = 0;
    for (const [k, count] of Object.entries(kindCounts)) {
      if (count > maxCount) {
        maxCount = count;
        primaryKind = k;
      }
    }

    // Determine Overall Risk Level
    let overallLevel: RiskLevel = 'none';
    if (allRiskTagsSet.has('auth_security') || allRiskTagsSet.has('database_schema')) {
      overallLevel = 'high';
    } else if (allRiskTagsSet.has('public_api') || allRiskTagsSet.has('secret_config')) {
      overallLevel = 'medium';
    } else if (allRiskTagsSet.size > 0) {
      overallLevel = 'low';
    }

    const coverageData: PRCoverageV4 = {
      schema_version: '4.0',
      sections: {
        metadata: { status: 'complete', truncated: false, items_fetched: 1, warning: null },
        commits: { status: 'complete', truncated: false, items_fetched: projectedCommits.length, warning: null },
        diffstat: { status: 'complete', truncated: false, items_fetched: projectedDiffstat.length, warning: null },
        diff: { status: 'complete', truncated: false, items_fetched: parsedDiff.files.length, warning: null },
        file_analysis: { status: 'complete', truncated: false, items_fetched: fileEntries.length, warning: null },
        symbols: { status: 'complete', truncated: false, items_fetched: Array.from(fileChangesMap.values()).reduce((sum, f) => sum + f.change.symbols.length, 0), warning: null },
        comments: { status: 'not_fetched', truncated: false, items_fetched: 0, warning: null },
        ci: { status: 'not_fetched', truncated: false, items_fetched: 0, warning: null },
        related_context: { status: 'not_fetched', truncated: false, items_fetched: 0, warning: null }
      }
    };

    const manifestData = {
      title: sanitizedTitle,
      description: sanitizedDesc,
      state: projectedMeta.state || 'OPEN',
      is_draft: false,
      source_branch: projectedMeta.source.branch.name,
      target_branch: projectedMeta.destination.branch.name,
      source_commit: rawRev.sourceHash,
      target_commit: rawRev.destinationHash,
      ticket_id: ticketId !== 'N/A' ? ticketId : null,
      change_summary: {
        total_files: fileEntries.length,
        total_additions: totalAdditions,
        total_deletions: totalDeletions,
        primary_kind: primaryKind,
        kind_counts: kindCounts
      },
      risk_summary: {
        overall_level: overallLevel,
        total_risk_tags: Array.from(allRiskTagsSet),
        risky_files_count: riskyFilesCount
      },
      stats: {
        files_changed: fileEntries.length,
        commits_count: projectedCommits.length
      },
      important_file_ids: importantFileIds,
      index_refs: {
        files_index: 'files.index.jsonl',
        commits: 'commits.jsonl',
        coverage: 'coverage.json'
      },
      redaction_summary: {
        scanned: true,
        redacted_items_count: tracker.getReport(privacy.mode).redacted_values
      },
      analyzer_version: '4.0.0'
    };

    const commitsJsonl = projectedCommits.map(c => JSON.stringify(c));

    const result = RevisionWriter.writeRevision(
      workspace,
      repoSlug,
      prId,
      rawRev.sourceHash,
      rawRev.destinationHash,
      manifestData,
      fileEntries,
      fileChangesMap,
      commitsJsonl,
      coverageData
    );

    const cacheKey = `bitbucket:${workspace}:${repoSlug}:${prId}:${rawRev.sourceHash.substring(0, 7)}:${rawRev.destinationHash.substring(0, 7)}:v4`;

    return { cacheKey, manifest: result.manifest };
  }

  private static getLanguageForPath(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case '.cs': return 'csharp';
      case '.ts': return 'typescript';
      case '.js': return 'javascript';
      case '.py': return 'python';
      case '.go': return 'go';
      case '.sql': return 'sql';
      case '.proto': return 'protobuf';
      case '.json': return 'json';
      case '.yaml': case '.yml': return 'yaml';
      case '.md': return 'markdown';
      default: return 'text';
    }
  }
}
