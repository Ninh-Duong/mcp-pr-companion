import { z } from 'zod';

const IsoTimestampSchema = z.string().datetime({ offset: true });

export const LiveReviewPointerV1Schema = z.object({
  snapshot_id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/)
}).strict();

export const LiveReviewIndexV1Schema = z.object({
  schema_version: z.literal(1),
  snapshot_id: z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/),
  fetched_at: IsoTimestampSchema,
  source_commit: z.string().min(1).max(256),
  comment_count: z.number().int().nonnegative(),
  complete: z.boolean(),
  warnings: z.array(z.string().max(500)).max(50).default([])
}).strict();

export const LiveReviewAttemptV1Schema = z.object({
  schema_version: z.literal(1),
  attempted_at: IsoTimestampSchema,
  complete: z.boolean(),
  warnings: z.array(z.string().max(500)).max(50),
  source_commit: z.string().min(1).max(256),
  retained_snapshot_id: LiveReviewIndexV1Schema.shape.snapshot_id.nullable()
}).strict();

export const LiveReviewCommentV1Schema = z.object({
  id: z.number().int().nonnegative(),
  parent_id: z.number().int().nonnegative().nullable(),
  author: z.string().optional(),
  author_kind: z.enum(['person', 'app']),
  created_on: IsoTimestampSchema,
  resolved: z.boolean(),
  file_id: z.string().min(1).nullable().optional(),
  path: z.string().optional(),
  line: z.number().int().nonnegative().nullable().optional(),
  text: z.string()
}).strict();

export type LiveReviewPointerV1 = z.infer<typeof LiveReviewPointerV1Schema>;
export type LiveReviewIndexV1 = z.infer<typeof LiveReviewIndexV1Schema>;
export type LiveReviewAttemptV1 = z.infer<typeof LiveReviewAttemptV1Schema>;
export type LiveReviewCommentV1 = z.infer<typeof LiveReviewCommentV1Schema>;

export const LiveReviewCompleteSnapshotV1Schema = z.object({
  schema_version: z.literal(1),
  snapshot_id: LiveReviewIndexV1Schema.shape.snapshot_id,
  fetched_at: IsoTimestampSchema,
  source_commit: z.string().min(1).max(256),
  comment_count: z.number().int().nonnegative(),
  complete: z.literal(true),
  warnings: z.array(z.string().max(500)).max(50).default([]),
  comments: z.array(LiveReviewCommentV1Schema)
}).strict().superRefine((snapshot, context) => {
  if (snapshot.comment_count !== snapshot.comments.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: 'comment_count must match comments length', path: ['comment_count'] });
  }
  for (let index = 1; index < snapshot.comments.length; index += 1) {
    if (snapshot.comments[index - 1].id >= snapshot.comments[index].id) {
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'comments must be sorted by ascending unique id', path: ['comments', index, 'id'] });
      break;
    }
  }
});

export type LiveReviewCompleteSnapshotV1 = z.infer<typeof LiveReviewCompleteSnapshotV1Schema>;
