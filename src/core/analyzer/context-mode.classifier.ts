import { PRManifestV4 } from '../output/schema/manifest.v4.schema.js';
import { FileIndexEntryV4 } from '../output/schema/file_index.v4.schema.js';

export type ContextMode = 'skim' | 'standard' | 'inspect_priority_files' | 'deep_review';

export interface AIReadingMetadata {
  mode: ContextMode;
  reason: string;
  required_next_files: string[];
  optional_next_files: string[];
  skip_categories: string[];
  token_budget: 'small' | 'medium' | 'large' | 'extensive';
}

export class ContextModeClassifier {
  public static classify(
    manifest: Omit<PRManifestV4, 'schema_version'> | PRManifestV4,
    fileEntries: FileIndexEntryV4[]
  ): AIReadingMetadata {
    const totalFiles = manifest.change_summary?.total_files ?? fileEntries.length;
    const overallRisk = manifest.risk_summary?.overall_level ?? 'none';
    const primaryKind = manifest.change_summary?.primary_kind ?? 'functional_logic';
    const riskTags = manifest.risk_summary?.total_risk_tags ?? [];
    const riskyFilesCount = manifest.risk_summary?.risky_files_count ?? 0;

    const highRiskTags = ['public_api', 'auth_security', 'database_schema', 'secret_config'];
    const containsHighRiskTags = riskTags.some(tag => highRiskTags.includes(tag));

    // Sort files by risk and change volume to identify priority files
    const priorityFiles = [...fileEntries].sort((a, b) => {
      const getWeight = (tags: string[]) => {
        if (tags.includes('auth_security') || tags.includes('public_api')) return 100;
        if (tags.includes('database_schema') || tags.includes('secret_config')) return 80;
        return 10;
      };
      return (getWeight(b.risk_tags) + b.additions + b.deletions) - (getWeight(a.risk_tags) + a.additions + a.deletions);
    });

    const skimKinds = ['comment_only', 'documentation_only', 'whitespace_only', 'formatting_only', 'test_only', 'unit_test'];
    const isSkimKind = skimKinds.includes(primaryKind);

    // Rule 1: Skim Mode
    if (totalFiles <= 3 && (overallRisk === 'none' || overallRisk === 'low') && isSkimKind && !containsHighRiskTags) {
      const optionalNext = priorityFiles.length > 0 ? [`files/${priorityFiles[0].id}.md`] : [];
      return {
        mode: 'skim',
        reason: `${primaryKind}, risk ${overallRisk}, ${totalFiles} file(s) changed`,
        required_next_files: [],
        optional_next_files: optionalNext,
        skip_categories: ['full_patch_review', 'security_review', 'test_impact_review'],
        token_budget: 'small'
      };
    }

    // Rule 2: Deep Review Mode
    if (overallRisk === 'high' || overallRisk === 'critical' || totalFiles > 30) {
      const reqNext = priorityFiles.slice(0, 5).map(f => `files/${f.id}.md`);
      return {
        mode: 'deep_review',
        reason: `High risk (${overallRisk}) or large file count (${totalFiles} files)`,
        required_next_files: reqNext,
        optional_next_files: priorityFiles.slice(5, 10).map(f => `files/${f.id}.md`),
        skip_categories: [],
        token_budget: 'extensive'
      };
    }

    // Rule 3: Inspect Priority Files Mode
    if (containsHighRiskTags || riskyFilesCount > 0 || totalFiles > 10) {
      const riskyFiles = priorityFiles.filter(f => f.risk_tags.length > 0);
      const reqNext = (riskyFiles.length > 0 ? riskyFiles : priorityFiles).slice(0, 3).map(f => `files/${f.id}.md`);
      const optNext = priorityFiles.filter(f => !reqNext.includes(`files/${f.id}.md`)).slice(0, 5).map(f => `files/${f.id}.md`);

      const reasons: string[] = [];
      if (containsHighRiskTags) reasons.push(`risk tags: ${riskTags.join(', ')}`);
      if (riskyFilesCount > 0) reasons.push(`${riskyFilesCount} risky file(s)`);
      if (totalFiles > 10) reasons.push(`${totalFiles} files changed`);

      return {
        mode: 'inspect_priority_files',
        reason: reasons.join('; '),
        required_next_files: reqNext,
        optional_next_files: optNext,
        skip_categories: ['generated_files'],
        token_budget: 'large'
      };
    }

    // Rule 4: Standard Mode
    const reqNext = priorityFiles.slice(0, 2).map(f => `files/${f.id}.md`);
    const optNext = priorityFiles.slice(2, 5).map(f => `files/${f.id}.md`);

    return {
      mode: 'standard',
      reason: `Standard changes in ${totalFiles} file(s), primary kind: ${primaryKind}`,
      required_next_files: reqNext,
      optional_next_files: optNext,
      skip_categories: ['unmodified_vendor_files'],
      token_budget: 'medium'
    };
  }
}
