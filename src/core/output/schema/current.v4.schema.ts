import { z } from 'zod';

/** current.json: the active revision pointer of a PR directory, written last by RevisionWriter (the commit point). */
export const PRCurrentV4Schema = z.object({
  active_revision: z.string(),
  updated_at: z.string().optional(),
  generated_at: z.string().optional(),
  source_commit: z.string().optional(),
  source_hash: z.string().optional(),
  target_commit: z.string().optional(),
  destination_hash: z.string().optional(),
  context_path: z.string().optional(),
  files_summary_path: z.string().optional(),
  actions_path: z.string().optional(),
  manifest_path: z.string().optional(),
  active_revision_path: z.string().optional(),
  ai_reading_mode: z.string().optional(),
  // Time (ISO) of the last successful freshness check against Bitbucket that found this revision current.
  freshness_checked_at: z.string().optional()
}).passthrough();

export type PRCurrentV4 = z.infer<typeof PRCurrentV4Schema>;
