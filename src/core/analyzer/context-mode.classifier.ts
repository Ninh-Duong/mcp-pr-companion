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

/** Kinds a reviewer rarely needs to open: listed by id under "low_priority", never in Read next / Optional. */
const LOW_VALUE_KINDS = ['test_only', 'unit_test', 'generated_only', 'rename_only', 'formatting_only', 'whitespace_only', 'comment_only', 'documentation_only'];
/** Files with these tags are always in Read next, whatever their size. */
const MUST_READ_TAGS = ['auth_security', 'database_schema', 'public_api', 'sensitive_configuration'];

export class ContextModeClassifier {
  /** Review priority of one file: change volume (capped), risk tags, and brand-new logic. Shared with files.md ordering. */
  static score(f: FileIndexEntryV4): number {
    if (LOW_VALUE_KINDS.includes(f.change_kind)) return -1;
    const has = (...tags: string[]) => tags.some(t => f.risk_tags.includes(t));
    return Math.min(f.additions + f.deletions, 200)
      + (has('auth_security', 'database_schema', 'public_api', 'sensitive_configuration') ? 60 : 0)
      + (has('secret_config', 'concurrency_transaction', 'database_object') ? 40 : 0)
      + (f.status === 'added' && f.change_kind === 'functional_logic' ? 30 : 0)
      + (has('dependency') ? 10 : 0);
  }

  /** Every file, highest review priority first (stable for equal scores). */
  static rank(fileEntries: FileIndexEntryV4[]): FileIndexEntryV4[] {
    return [...fileEntries].sort((a, b) => this.score(b) - this.score(a));
  }

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

    const ranked = this.rank(fileEntries);
    const lowValue = ranked.filter(f => this.score(f) < 0);
    // A PR made only of tests or docs still gets something to read.
    const priorityFiles = lowValue.length === ranked.length ? ranked : ranked.filter(f => this.score(f) >= 0);
    const ref = (f: FileIndexEntryV4) => `files/${f.id}.md`;

    // Read next: the top `count`, plus every must-read file; Optional: the next five.
    const pick = (count: number) => {
      const required = [...priorityFiles.slice(0, count), ...priorityFiles.slice(count).filter(f => f.risk_tags.some(t => MUST_READ_TAGS.includes(t)))];
      return {
        required_next_files: required.map(ref),
        optional_next_files: priorityFiles.filter(f => !required.includes(f)).slice(0, 5).map(ref)
      };
    };
    const lowPriority = lowValue.length > 0 && lowValue.length < ranked.length
      ? [`low_priority: ${lowValue.slice(0, 10).map(f => `${f.id} (${f.change_kind})`).join(', ')}${lowValue.length > 10 ? ` (+${lowValue.length - 10})` : ''}`]
      : [];

    const skimKinds = ['comment_only', 'documentation_only', 'whitespace_only', 'formatting_only', 'rename_only', 'test_only', 'unit_test'];
    const isSkimKind = skimKinds.includes(primaryKind);

    // Rule 1: Skim Mode
    if (totalFiles <= 3 && (overallRisk === 'none' || overallRisk === 'low') && isSkimKind && !containsHighRiskTags) {
      return {
        mode: 'skim',
        reason: `${primaryKind}, risk ${overallRisk}, ${totalFiles} file(s) changed`,
        required_next_files: [],
        optional_next_files: ranked.slice(0, 1).map(ref),
        skip_categories: ['full_patch_review', 'security_review', 'test_impact_review'],
        token_budget: 'small'
      };
    }

    // Rule 2: Deep Review Mode
    if (overallRisk === 'high' || overallRisk === 'critical' || totalFiles > 30) {
      return {
        mode: 'deep_review',
        reason: `High risk (${overallRisk}) or large file count (${totalFiles} files)`,
        ...pick(5),
        skip_categories: lowPriority,
        token_budget: 'extensive'
      };
    }

    // Rule 3: Inspect Priority Files Mode
    if (containsHighRiskTags || riskyFilesCount > 0 || totalFiles > 10) {
      const reasons: string[] = [];
      if (containsHighRiskTags) reasons.push(`risk tags: ${riskTags.join(', ')}`);
      if (riskyFilesCount > 0) reasons.push(`${riskyFilesCount} risky file(s)`);
      if (totalFiles > 10) reasons.push(`${totalFiles} files changed`);

      return {
        mode: 'inspect_priority_files',
        reason: reasons.join('; '),
        ...pick(3),
        skip_categories: ['generated_files', ...lowPriority],
        token_budget: 'large'
      };
    }

    // Rule 4: Standard Mode
    return {
      mode: 'standard',
      reason: `Standard changes in ${totalFiles} file(s), primary kind: ${primaryKind}`,
      ...pick(2),
      skip_categories: ['unmodified_vendor_files', ...lowPriority],
      token_budget: 'medium'
    };
  }
}
