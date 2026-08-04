import { z } from 'zod';

export const FileIndexEntryV4Schema = z.object({
  id: z.string(),
  path: z.string(),
  old_path: z.string().nullable(),
  language: z.string(),
  status: z.enum(['added', 'modified', 'removed', 'renamed']),
  additions: z.number(),
  deletions: z.number(),
  change_kind: z.string(),
  risk_tags: z.array(z.string()),
  detail_ref: z.string(),
  path_redacted: z.boolean().optional(),
  path_mode: z.enum(['original', 'sanitized', 'redacted']).optional()
});

export type FileIndexEntryV4 = z.infer<typeof FileIndexEntryV4Schema>;
