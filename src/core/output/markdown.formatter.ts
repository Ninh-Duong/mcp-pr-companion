import { PRManifestV4 } from './schema/manifest.v4.schema.js';
import { FileIndexEntryV4 } from './schema/file_index.v4.schema.js';
import { FileChangeV4 } from './schema/file_change.v4.schema.js';
import { PRCoverageV4 } from './schema/coverage.v4.schema.js';
import { AIReadingMetadata, ContextModeClassifier } from '../analyzer/context-mode.classifier.js';
import path from 'path';

export class MarkdownFormatter {
  static formatContextPack(
    repository: string,
    manifest: PRManifestV4,
    commitsJsonl: string[],
    aiReading: AIReadingMetadata,
    fileEntries: FileIndexEntryV4[] = [],
    coverage?: PRCoverageV4
  ): string {
    const lines: string[] = [];
    // Classifier entries are "files/file_0001.md"; agents pass the bare id to the file tools.
    const ids = (refs: string[]) => refs.map(r => path.basename(r, '.md')).join(', ');

    lines.push(`# PR Context Pack: ${manifest.title}`);
    lines.push('');

    // A failed or cut download must be visible: otherwise missing files look like a small, safe PR.
    for (const name of ['diff', 'diffstat', 'commits'] as const) {
      const s = coverage?.sections[name];
      if (!s || s.status === 'complete') continue;
      const why = s.warning ? ` (${s.warning.length > 200 ? `${s.warning.slice(0, 200)}…` : s.warning})` : '';
      lines.push(`Warning: ${name} ${s.status}${why}. Some changes may be missing; call get_pr_context_pack with refresh=true.`);
    }
    if (lines.length > 2) lines.push('');
    lines.push('## Read Strategy');
    lines.push(`Mode: ${aiReading.mode} (token budget: ${aiReading.token_budget})`);
    lines.push(`Reason: ${aiReading.reason}`);
    if (aiReading.required_next_files.length > 0) lines.push(`Read next: ${ids(aiReading.required_next_files)}`);
    if (aiReading.optional_next_files.length > 0) lines.push(`Optional: ${ids(aiReading.optional_next_files)}`);
    const LOW = 'low_priority: ';
    const skip = aiReading.skip_categories.filter(s => !s.startsWith(LOW));
    if (skip.length > 0) lines.push(`Skip: ${skip.join(', ')}`);
    for (const s of aiReading.skip_categories.filter(s => s.startsWith(LOW))) lines.push(`Low priority: ${s.slice(LOW.length)}`);
    lines.push('');

    const since = manifest.changes_since_previous;
    if (since) {
      const byId = new Map(fileEntries.map(f => [f.id, f]));
      lines.push(`## Changed since last sync (${since.previous_revision})`);
      if (since.changed_file_ids.length === 0) lines.push('Files: none (only commits or metadata moved)');
      // Capped: after a rebase every file can differ (invariant 4).
      for (const id of since.changed_file_ids.slice(0, 30)) {
        const f = byId.get(id);
        lines.push(f ? `- ${id} \`${f.path}\` (${f.status})` : `- ${id}`);
      }
      if (since.changed_file_ids.length > 30) lines.push(`- … ${since.changed_file_ids.length - 30} more changed files: use search_pr_files`);
      const removed = since.removed_paths;
      if (removed.length > 0) lines.push(`No longer in the PR: ${removed.slice(0, 20).join(', ')}${removed.length > 20 ? ` (+${removed.length - 20} more)` : ''}`);
      lines.push('');
    }
    lines.push('## Overview');
    lines.push(`- **Repository**: ${repository}`);
    lines.push(`- **Branches**: \`${manifest.source_branch}\` -> \`${manifest.target_branch}\``);
    lines.push(`- **State**: ${manifest.state}`);
    lines.push(`- **Ticket**: ${manifest.ticket_id || 'N/A'}`);
    const why = manifest.risk_summary.reasons ?? [];
    lines.push(`- **Overall Risk**: ${manifest.risk_summary.overall_level}${why.length > 0 ? ` (${why.join('; ')})` : ''}`);
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

    const { commits_count, commits_shown = commitsJsonl.length } = manifest.stats;
    lines.push(commits_count > commits_shown
      ? `## Commits (${commits_shown} of ${commits_count} shown, newest first; merge commits omitted)`
      : '## Commits');
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
    lines.push('## All files (highest review priority first)');

    lines.push('| File ID | Path | Kind | Status | +/- | Risk Tags |');
    lines.push('| --- | --- | --- | --- | --- | --- |');

    // Capped at 200 rows: the table is appended to the context pack by include_file_table (invariant 4).
    const ranked = ContextModeClassifier.rank(fileEntries);
    ranked.slice(0, 200).forEach((f) => {
      const riskTagsStr = f.risk_tags.length > 0 ? f.risk_tags.join(', ') : 'none';
      const shownPath = f.old_path && f.old_path !== f.path ? `${f.old_path} → ${f.path}` : f.path;
      lines.push(
        `| ${f.id} | ${shownPath} | ${f.change_kind} | ${f.status} | +${f.additions}/-${f.deletions} | ${riskTagsStr} |`
      );
    });
    if (ranked.length > 200) lines.push('', `${ranked.length - 200} more files: use search_pr_files to list them.`);

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
    if (entry.old_path && entry.old_path !== entry.path) lines.push(`- **Moved from**: \`${entry.old_path}\``);
    const symbols = detail.change.symbols;
    if (symbols.length > 0) {
      const shown = symbols.slice(0, 12).map(s => `${s.name} (${s.kind}${s.relationship === 'containing_symbol' ? ', contains change' : `, ${s.change.replace('_symbol', '')}`})`);
      lines.push(`- **Symbols**: ${shown.join(', ')}${symbols.length > 12 ? ` (+${symbols.length - 12})` : ''}`);
    }
    lines.push('');

    lines.push('## Diff Patch');
    lines.push('```diff');
    lines.push(detail.diffContent || '');
    lines.push('```');

    return lines.join('\n');
  }
}
