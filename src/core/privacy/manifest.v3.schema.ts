import { z } from 'zod';

export const PRManifestV3Schema = z.object({
  schema_version: z.literal('3.0'),
  document_type: z.literal('pr_manifest'),
  repository_id: z.string(), // Opaque ID (e.g. repo_8f24a1)
  pr: z.object({
    id: z.number(),
    ticket_id: z.string().nullable(),
    title: z.string(),
    state: z.string().default('open'),
    draft: z.boolean().default(false)
  }),
  revision: z.object({
    id: z.string() // Opaque Revision ID (e.g. rev_a381cc82f8b4)
  }),
  change_summary: z.object({
    type: z.enum([
      'comment_only',
      'formatting_only',
      'functional_logic',
      'database_migration',
      'grpc_contract',
      'sensitive_configuration',
      'mixed'
    ]),
    functional_change: z.boolean(),
    risk_level: z.enum(['low', 'medium', 'high', 'critical']),
    confidence: z.number().min(0).max(1)
  }),
  stats: z.object({
    commits: z.number(),
    files: z.number(),
    additions: z.number(),
    deletions: z.number()
  }),
  files: z.array(
    z.object({
      id: z.string(), // e.g. file_0001
      category: z.string(),
      status: z.string(),
      change_types: z.array(z.string()),
      risk_tags: z.array(z.string())
    })
  ),
  coverage: z.object({
    metadata: z.string().default('complete'),
    commits: z.string().default('complete'),
    diffstat: z.string().default('complete'),
    diff: z.string().default('complete'),
    comments: z.string().default('not_fetched'),
    ci: z.string().default('not_fetched')
  }),
  redaction: z.object({
    mode: z.string(),
    pii_removed: z.boolean(),
    secrets_scanned: z.boolean(),
    redacted_values: z.number()
  }),
  generated_at: z.string()
});

export type PRManifestV3 = z.infer<typeof PRManifestV3Schema>;
