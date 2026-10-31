import { z } from 'zod';

export const ChangedSymbolSchema = z.object({
  kind: z.string(),
  name: z.string(),
  change: z.enum(['added_symbol', 'modified_symbol', 'deleted_symbol', 'comment_near_symbol']),
  signature: z.string().optional(),
  line: z.number().optional(),
  confidence: z.number().optional(),
  relationship: z.enum(['changed_symbol', 'containing_symbol', 'nearest_symbol']).optional()
});

export type ChangedSymbol = z.infer<typeof ChangedSymbolSchema>;

export const FileChangeV4Schema = z.object({
  schema_version: z.literal('4.0'),
  file_id: z.string(),
  classification: z.object({
    kind: z.string(),
    functional_change: z.boolean(),
    confidence: z.number(),
    evidence: z.array(z.string())
  }),
  symbols: z.array(ChangedSymbolSchema),
  risk: z.object({
    level: z.enum(['none', 'low', 'medium', 'high', 'critical']),
    tags: z.array(z.string()),
    evidence: z.array(z.string())
  }),
  patch_ref: z.string(),
  context_ref: z.string().nullable(),
  redaction_result: z.object({
    scanned: z.boolean(),
    content_modified: z.boolean()
  })
});

export type FileChangeV4 = z.infer<typeof FileChangeV4Schema>;
