import { z } from 'zod';

export const PRFileDetailV3Schema = z.object({
  schema_version: z.literal('3.0'),
  document_type: z.literal('pr_file_detail'),
  file_id: z.string(), // e.g. file_0001
  path: z.object({
    mode: z.enum(['full', 'sanitized', 'basename', 'opaque']),
    value: z.string()
  }),
  language: z.string(),
  status: z.string(),
  stats: z.object({
    additions: z.number(),
    deletions: z.number()
  }),
  symbols: z.array(
    z.object({
      name: z.string(),
      kind: z.string(),
      change: z.string()
    })
  ),
  changes: z.array(
    z.object({
      kind: z.string(),
      new_line: z.number().optional(),
      old_line: z.number().optional(),
      content: z.string().optional(),
      functional_change: z.boolean()
    })
  ),
  risk_tags: z.array(z.string()),
  content_omitted: z.boolean().optional(),
  redaction: z.object({
    content_modified: z.boolean(),
    reasons: z.array(z.string())
  })
});

export type PRFileDetailV3 = z.infer<typeof PRFileDetailV3Schema>;
