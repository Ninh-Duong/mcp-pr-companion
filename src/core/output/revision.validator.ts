import fs from 'fs';
import path from 'path';
import { PRManifestV4Schema, PRManifestV4 } from './schema/manifest.v4.schema.js';
import { FileIndexEntryV4Schema, FileIndexEntryV4 } from './schema/file_index.v4.schema.js';
import { FileChangeV4Schema, FileChangeV4 } from './schema/file_change.v4.schema.js';
import { PRCoverageV4Schema } from './schema/coverage.v4.schema.js';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export class RevisionValidator {
  static validate(stagingDir: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    const resolvedStagingDir = path.resolve(stagingDir);

    // 1. Required Files Existence
    const manifestPath = path.join(resolvedStagingDir, 'manifest.json');
    const indexPath = path.join(resolvedStagingDir, 'files.index.jsonl');
    const commitsPath = path.join(resolvedStagingDir, 'commits.jsonl');
    const coveragePath = path.join(resolvedStagingDir, 'coverage.json');

    if (!fs.existsSync(manifestPath)) errors.push(`Missing manifest.json at ${manifestPath}`);
    if (!fs.existsSync(indexPath)) errors.push(`Missing files.index.jsonl at ${indexPath}`);
    if (!fs.existsSync(commitsPath)) errors.push(`Missing commits.jsonl at ${commitsPath}`);
    if (!fs.existsSync(coveragePath)) errors.push(`Missing coverage.json at ${coveragePath}`);

    if (errors.length > 0) {
      return { valid: false, errors, warnings };
    }

    // 2. Validate manifest.json Schema
    let manifest: PRManifestV4 | null = null;
    try {
      const manifestRaw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      manifest = PRManifestV4Schema.parse(manifestRaw);
    } catch (err: any) {
      errors.push(`manifest.json schema validation failed: ${err.message || String(err)}`);
    }

    // 3. Validate coverage.json Schema
    try {
      const coverageRaw = JSON.parse(fs.readFileSync(coveragePath, 'utf-8'));
      PRCoverageV4Schema.parse(coverageRaw);
    } catch (err: any) {
      errors.push(`coverage.json schema validation failed: ${err.message || String(err)}`);
    }

    // 4. Validate files.index.jsonl Schema & References
    const fileEntries: FileIndexEntryV4[] = [];
    const indexFileIds = new Set<string>();

    try {
      const indexLines = fs.readFileSync(indexPath, 'utf-8').split('\n').filter(Boolean);
      indexLines.forEach((line, idx) => {
        try {
          const entryRaw = JSON.parse(line);
          const entry = FileIndexEntryV4Schema.parse(entryRaw);
          
          if (indexFileIds.has(entry.id)) {
            errors.push(`Duplicate file_id '${entry.id}' found in files.index.jsonl at line ${idx + 1}`);
          }
          indexFileIds.add(entry.id);
          fileEntries.push(entry);

          // Path Traversal Check & Reference Existence
          const resolvedDetailPath = path.resolve(resolvedStagingDir, entry.detail_ref);
          if (!resolvedDetailPath.startsWith(resolvedStagingDir)) {
            errors.push(`Path traversal detected in detail_ref: ${entry.detail_ref}`);
          } else if (!fs.existsSync(resolvedDetailPath)) {
            errors.push(`Referenced detail_ref does not exist: ${entry.detail_ref}`);
          } else {
            // Validate change.json schema
            try {
              const changeRaw = JSON.parse(fs.readFileSync(resolvedDetailPath, 'utf-8'));
              const fileChange = FileChangeV4Schema.parse(changeRaw);

              // Check patch_ref
              const resolvedPatchPath = path.resolve(path.dirname(resolvedDetailPath), fileChange.patch_ref);
              if (!resolvedPatchPath.startsWith(resolvedStagingDir)) {
                errors.push(`Path traversal detected in patch_ref for file '${entry.id}'`);
              } else if (!fs.existsSync(resolvedPatchPath)) {
                errors.push(`Referenced patch_ref does not exist for file '${entry.id}': ${fileChange.patch_ref}`);
              }
            } catch (err: any) {
              errors.push(`change.json schema validation failed for '${entry.id}': ${err.message || String(err)}`);
            }
          }
        } catch (err: any) {
          errors.push(`files.index.jsonl line ${idx + 1} validation failed: ${err.message || String(err)}`);
        }
      });
    } catch (err: any) {
      errors.push(`Failed to read files.index.jsonl: ${err.message || String(err)}`);
    }

    // 5. Cross-Check Manifest Integrity & Aggregates
    if (manifest) {
      // Check total_files counter
      if (manifest.change_summary.total_files !== fileEntries.length) {
        errors.push(
          `Manifest total_files (${manifest.change_summary.total_files}) does not match index length (${fileEntries.length})`
        );
      }

      // Check additions & deletions
      const sumAdditions = fileEntries.reduce((acc, curr) => acc + curr.additions, 0);
      const sumDeletions = fileEntries.reduce((acc, curr) => acc + curr.deletions, 0);

      if (manifest.change_summary.total_additions !== sumAdditions) {
        errors.push(
          `Manifest total_additions (${manifest.change_summary.total_additions}) does not match sum of index additions (${sumAdditions})`
        );
      }

      if (manifest.change_summary.total_deletions !== sumDeletions) {
        errors.push(
          `Manifest total_deletions (${manifest.change_summary.total_deletions}) does not match sum of index deletions (${sumDeletions})`
        );
      }

      // Check important_file_ids existence
      for (const impId of manifest.important_file_ids) {
        if (!indexFileIds.has(impId)) {
          errors.push(`important_file_id '${impId}' in manifest does not exist in files.index.jsonl`);
        }
      }

      // Check kind_counts match index
      const recalculatedKindCounts: Record<string, number> = {};
      fileEntries.forEach(e => {
        const k = e.change_kind || 'unknown';
        recalculatedKindCounts[k] = (recalculatedKindCounts[k] || 0) + 1;
      });

      for (const [kind, count] of Object.entries(recalculatedKindCounts)) {
        if ((manifest.change_summary.kind_counts[kind] || 0) !== count) {
          warnings.push(
            `Kind count mismatch for '${kind}': manifest has ${manifest.change_summary.kind_counts[kind]}, computed ${count}`
          );
        }
      }
    }

    // 6. Check for Orphan Files in files/ directory
    const filesDir = path.join(resolvedStagingDir, 'files');
    if (fs.existsSync(filesDir)) {
      const subdirs = fs.readdirSync(filesDir);
      for (const dirName of subdirs) {
        if (!indexFileIds.has(dirName)) {
          warnings.push(`Orphan directory found in files/: '${dirName}' is not referenced in files.index.jsonl`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings
    };
  }

  static validateOrThrow(stagingDir: string): void {
    const result = this.validate(stagingDir);
    if (!result.valid) {
      throw new Error(`Revision validation failed:\n - ${result.errors.join('\n - ')}`);
    }
  }
}
