import { z } from 'zod';

export const BaseConfigSchema = z.object({
  workspace: z.string().default(''),
  ticket_prefix: z.array(z.string()).default(['WCE-', 'PROJ-', 'JIRA-']),
  allowed_emails: z.array(z.string()).default([]),
  privacy: z.object({
    mode: z.enum(['strict', 'balanced', 'debug']).default('strict'),
    remove_author: z.boolean().default(true),
    file_path_mode: z.enum(['full', 'sanitized', 'basename', 'opaque']).default('sanitized'),
    max_commit_subjects: z.number().default(10)
  }).default({}),
  ai_context: z.object({
    root: z.string().default('ai-context'),
    company: z.string().default('siliconstack'),
    app: z.string().default('bitbucket')
  }).default({})
});

export type BaseConfig = z.infer<typeof BaseConfigSchema>;
