import { PRManifestV4 } from './schema/manifest.v4.schema.js';
import { FileIndexEntryV4 } from './schema/file_index.v4.schema.js';
import { FileChangeV4 } from './schema/file_change.v4.schema.js';
import { PRCoverageV4 } from './schema/coverage.v4.schema.js';

export class MarkdownFormatter {
  static formatContextPack(
    company: string,
    appName: string,
    featureName: string,
    folderName: string,
    workspace: string,
    repoSlug: string,
    manifest: PRManifestV4,
    fileEntries: FileIndexEntryV4[],
    fileChangesMap: Map<string, { change: FileChangeV4; diffContent: string }>,
    commitsJsonl: string[],
    coverageData: PRCoverageV4,
    aiReading: { mode: string; priority_file_ids?: string[]; reason?: string }
  ): string {
    const lines: string[] = [];

    lines.push(`# PR Context Pack: ${manifest.title}`);
    lines.push('');
    lines.push('## Read Strategy');
    lines.push(`Mode: ${aiReading.mode}`);
    if (aiReading.reason) {
      lines.push(`Reason: ${aiReading.reason}`);
    }
    if (aiReading.priority_file_ids && aiReading.priority_file_ids.length > 0) {
      lines.push(`Priority File IDs: ${aiReading.priority_file_ids.join(', ')}`);
    }
    lines.push('');
    lines.push('## Overview');
    lines.push(`- **Repository**: ${workspace}/${repoSlug}`);
    lines.push(`- **Branches**: \`${manifest.source_branch}\` -> \`${manifest.target_branch}\``);
    lines.push(`- **State**: ${manifest.state}`);
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

  static formatActionsSummary(
    coverageData: PRCoverageV4,
    status: string = 'complete',
    provider: string = 'bitbucket'
  ): string {
    const lines: string[] = [];

    lines.push('# Actions & Coverage');
    lines.push('');
    lines.push(`- **Provider**: ${provider}`);
    lines.push(`- **Collection Status**: ${status}`);
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
