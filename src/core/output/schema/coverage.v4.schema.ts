import { z } from 'zod';

export const SectionCoverageItemSchema = z.object({
  status: z.enum(['complete', 'partial', 'not_available', 'not_requested', 'failed', 'not_fetched']),
  truncated: z.boolean(),
  items_fetched: z.number(),
  warning: z.string().nullable()
});

export type SectionCoverageItem = z.infer<typeof SectionCoverageItemSchema>;

export const PRCoverageV4Schema = z.object({
  schema_version: z.literal('4.0'),
  sections: z.object({
    metadata: SectionCoverageItemSchema,
    commits: SectionCoverageItemSchema,
    diffstat: SectionCoverageItemSchema,
    diff: SectionCoverageItemSchema,
    file_analysis: SectionCoverageItemSchema,
    symbols: SectionCoverageItemSchema,
    comments: SectionCoverageItemSchema,
    ci: SectionCoverageItemSchema,
    related_context: SectionCoverageItemSchema
  })
});

export type PRCoverageV4 = z.infer<typeof PRCoverageV4Schema>;
