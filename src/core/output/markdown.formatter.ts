import { PRManifestV4 } from './schema/manifest.v4.schema.js';
import { FileIndexEntryV4 } from './schema/file_index.v4.schema.js';
import { FileChangeV4 } from './schema/file_change.v4.schema.js';
import { PRCoverageV4 } from './schema/coverage.v4.schema.js';
import { AIReadingMetadata } from '../analyzer/context-mode.classifier.js';
import path from 'path';
import { getPRStorageStatus } from '../pr-status.js';

export class MarkdownFormatter {
  static formatContextPack(
    repository: string,
    manifest: PRManifestV4,
    commitsJsonl: string[],
    aiReading: AIReadingMetadata
  ): string {
    const lines: string[] = [];
    // Classifier entries are "files/file_0001.md"; agents pass the bare id to the file tools.
    const ids = (refs: string[]) => refs.map(r => path.basename(r, '.md')).join(', ');

    lines.push(`# PR Context Pack: ${manifest.title}`);
    lines.push('');
    lines.push('## Read Strategy');
    lines.push(`Mode: ${aiReading.mode} (token budget: ${aiReading.token_budget})`);
    lines.push(`Reason: ${aiReading.reason}`);
    if (aiReading.required_next_files.length > 0) lines.push(`Read next: ${ids(aiReading.required_next_files)}`);
    if (aiReading.optional_next_files.length > 0) lines.push(`Optional: ${ids(aiReading.optional_next_files)}`);
    if (aiReading.skip_categories.length > 0) lines.push(`Skip: ${aiReading.skip_categories.join(', ')}`);
    lines.push('');

    const since = manifest.changes_since_previous;
    if (since) {
      lines.push(`## Changed since last sync (${since.previous_revision})`);
      lines.push(since.changed_file_ids.length > 0
        ? `Files: ${since.changed_file_ids.join(', ')}`
        : 'Files: none (only commits or metadata moved)');
      if (since.removed_paths.length > 0) lines.push(`No longer in the PR: ${since.removed_paths.join(', ')}`);
      lines.push('');
    }
    lines.push('## Overview');
    lines.push(`- **Repository**: ${repository}`);
    lines.push(`- **Branches**: \`${manifest.source_branch}\` -> \`${manifest.target_branch}\``);
    lines.push(`- **State**: ${manifest.state}`);
    lines.push(`- **PR Status**: ${getPRStorageStatus(manifest.state, manifest.is_draft)}`);
    lines.push(`- **Ticket**: ${manifest.ticket_id || 'N/A'}`);
    lines.push(`- **Overall Risk**: ${manifest.risk_summary.overall_level}`);
    lines.push('');

    lines.push('## Change Summary');
    lines.push(`- Files Changed: ${manifest.change_summary.total_files}`);
    lines.push(`- Additions: +${manifest.change_summary.total_additions}`);
    lines.push(`- Deletions: -${manifest.change_summary.total_deletions}`);
    lines.push(`- Primary Kind: ${manifest.change_summary.primary_kind}`);
    lines.push('');

    lines.push('## Description');
    lines.push(manifest.description || '_No description provided._');
    lines.push('');

    lines.push('## Commits');
    commitsJsonl.forEach((commitRaw) => {
      try {
        const c = JSON.parse(commitRaw);
        lines.push(`- ${c.hash ? c.hash.substring(0, 7) : ''}: ${c.subject || c.message || ''}`);
      } catch {
        lines.push(`- ${commitRaw}`);
      }
    });

    return lines.join('\n');
  }

  static formatFilesSummaryList(fileEntries: FileIndexEntryV4[]): string {
    const lines: string[] = [];

    lines.push('# Files');
    lines.push('');
    lines.push('## Read First');

    const riskyOrPriority = fileEntries.filter((f) => f.risk_tags.length > 0);
    const standardFiles = fileEntries.filter((f) => f.risk_tags.length === 0);

    lines.push('| File ID | Path | Kind | Status | +/- | Risk Tags |');
    lines.push('| --- | --- | --- | --- | --- | --- |');

    [...riskyOrPriority, ...standardFiles].forEach((f) => {
      const riskTagsStr = f.risk_tags.length > 0 ? f.risk_tags.join(', ') : 'none';
      lines.push(
        `| ${f.id} | ${f.path} | ${f.change_kind} | ${f.status} | +${f.additions}/-${f.deletions} | ${riskTagsStr} |`
      );
    });

    return lines.join('\n');
  }

  static formatActionsSummary(coverageData: PRCoverageV4): string {
    const lines: string[] = [];

    lines.push('# Actions & Coverage');
    lines.push('');
    lines.push('- **Provider**: bitbucket');
    lines.push('');
    lines.push('## Coverage Overview');

    if (coverageData && coverageData.sections) {
      Object.entries(coverageData.sections).forEach(([sectionKey, info]) => {
        lines.push(`- **${sectionKey}**: ${info.status} (${info.items_fetched} items)`);
      });
    }

    return lines.join('\n');
  }

  static formatFileDetail(
    entry: FileIndexEntryV4,
    detail: { change: FileChangeV4; diffContent: string }
  ): string {
    const lines: string[] = [];

    lines.push(`# ${entry.id}`);
    lines.push('');
    lines.push(`- **Path**: \`${entry.path}\``);
    lines.push(`- **Status**: ${entry.status}`);
    lines.push(`- **Language**: ${entry.language}`);
    lines.push(`- **Change Kind**: ${entry.change_kind}`);
    lines.push(`- **Additions**: +${entry.additions}`);
    lines.push(`- **Deletions**: -${entry.deletions}`);
    lines.push(`- **Risk Tags**: ${entry.risk_tags.length > 0 ? entry.risk_tags.join(', ') : 'none'}`);
    lines.push('');

    lines.push('## Diff Patch');
    lines.push('```diff');
    lines.push(detail.diffContent || '');
    lines.push('```');

    return lines.join('\n');
  }
}
