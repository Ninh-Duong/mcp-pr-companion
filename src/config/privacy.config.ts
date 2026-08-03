import { z } from 'zod';

export const PrivacyConfigSchema = z.object({
  mode: z.enum(['strict', 'balanced', 'debug']).default('strict'),
  remove_author: z.boolean().default(true),
  remove_provider_links: z.boolean().default(true),
  remove_repository_identity: z.boolean().default(true),
  file_path_mode: z.enum(['full', 'sanitized', 'basename', 'opaque']).default('sanitized'),
  persist_provider_raw: z.boolean().default(false),
  persist_original_diff: z.boolean().default(false),
  persist_sanitized_hunks: z.boolean().default(true),
  scan_secrets: z.boolean().default(true),
  omit_sensitive_file_content: z.boolean().default(true),
  max_description_chars: z.number().default(1000),
  max_commit_subjects: z.number().default(10),
  raw_retention_hours: z.number().default(2)
}).default({});

export type PrivacyConfig = z.infer<typeof PrivacyConfigSchema>;
