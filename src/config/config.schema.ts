import { z } from 'zod';

// Env vars are strings: split comma lists, coerce booleans/numbers, treat '' as unset.
const unset = (v: unknown) => (v === '' ? undefined : v);
const list = (fallback: string[]) =>
  z.preprocess(
    v => (typeof v === 'string' ? v.split(',').map(s => s.trim()).filter(Boolean) : unset(v)),
    z.array(z.string()).default(fallback)
  );
const bool = (fallback: boolean) =>
  z.preprocess(v => (typeof v === 'string' && v !== '' ? v.trim().toLowerCase() === 'true' : unset(v)), z.boolean().default(fallback));
const num = (fallback: number) => z.preprocess(unset, z.coerce.number().int().positive().default(fallback));
const str = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(unset, schema);

export const BaseConfigSchema = z.object({
  ticket_prefix: list(['WCE-', 'PROJ-', 'JIRA-']),
  allowed_emails: list([]),
  privacy: z.object({
    mode: str(z.enum(['strict', 'balanced', 'debug']).default('strict')),
    remove_author: bool(true),
    file_path_mode: str(z.enum(['full', 'sanitized', 'basename', 'opaque']).default('sanitized')),
    max_commit_subjects: num(10)
  }),
  ai_context: z.object({
    root: str(z.string().default('ai-context')),
    company: str(z.string().default('siliconstack')),
    app: str(z.string().default('bitbucket'))
  })
});

export type BaseConfig = z.infer<typeof BaseConfigSchema>;
