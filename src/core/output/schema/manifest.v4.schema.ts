import { z } from 'zod';

export const ManifestProvenanceSchema = z.object({
  generated_at: z.string(),
  provider: z.string(),
  repository: z.string(),
  pull_request_id: z.union([z.number(), z.string()]).optional(),
  normalization_version: z.string()
});

export type ManifestProvenance = z.infer<typeof ManifestProvenanceSchema>;

export const PRManifestV4Schema = z.object({
  schema_version: z.literal('4.0'),
  title: z.string(),
  description: z.string(),
  description_meta: z.object({
    mode: z.enum(['raw', 'normalized', 'generated'])
  }).optional(),
  state: z.string(),
  is_draft: z.boolean(),
  source_branch: z.string(),
  target_branch: z.string(),
  source_commit: z.string(),
  target_commit: z.string(),
  ticket_id: z.string().nullable(),
  change_summary: z.object({
    total_files: z.number(),
    total_additions: z.number(),
    total_deletions: z.number(),
    primary_kind: z.string(),
    kind_counts: z.record(z.string(), z.number())
  }),
  risk_summary: z.object({
    overall_level: z.enum(['none', 'low', 'medium', 'high', 'critical']),
    total_risk_tags: z.array(z.string()),
    risky_files_count: z.number()
  }),
  stats: z.object({
    files_changed: z.number(),
    commits_count: z.number()
  }),
  important_file_ids: z.array(z.string()),
  index_refs: z.object({
    files_index: z.string(),
    commits: z.string(),
    coverage: z.string()
  }),
  redaction_summary: z.object({
    scanned: z.boolean(),
    redacted_items_count: z.number()
  }),
  analyzer_version: z.string(),
  provenance: ManifestProvenanceSchema.optional(),
  ai_reading: z.object({
    mode: z.enum(['skim', 'standard', 'inspect_priority_files', 'deep_review']),
    reason: z.string(),
    required_next_files: z.array(z.string()),
    optional_next_files: z.array(z.string()),
    skip_categories: z.array(z.string()),
    token_budget: z.enum(['small', 'medium', 'large', 'extensive'])
  }).optional()
});

export type PRManifestV4 = z.infer<typeof PRManifestV4Schema>;
