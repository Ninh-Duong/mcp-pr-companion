import { z } from 'zod';
import { PrivacyConfigSchema } from './privacy.config.js';

export const BaseConfigSchema = z.object({
  schema_version: z.number().default(3),
  provider: z.string().default('bitbucket-cloud'),
  workspace: z.string().default(''),
  output_language: z.enum(['vi', 'en', 'bilingual']).default('vi'),
  ticket_prefix: z.array(z.string()).default(['WCE-', 'PROJ-', 'JIRA-']),
  default_target_branch: z.string().default('main'),
  default_pr_url: z.string().default(''),
  privacy: PrivacyConfigSchema,
  sync: z.object({
    concurrency: z.number().default(2),
    request_timeout_ms: z.number().default(30000),
    max_retries: z.number().default(3)
  }).default({}),
  cache: z.object({
    memory_entries: z.number().default(20),
    ttl_seconds: z.number().default(300),
    persist_raw_diff: z.boolean().default(true),
    max_revisions_per_pr: z.number().default(3),
    retention_days: z.number().default(30)
  }).default({}),
  agent_payload: z.object({
    default_detail: z.enum(['manifest', 'full']).default('manifest'),
    max_highlights_per_file: z.number().default(5),
    include_generated_files: z.boolean().default(false)
  }).default({}),
  ai_context: z.object({
    root: z.string().default('ai-context'),
    company: z.string().default('siliconstack'),
    app: z.string().default('bitbucket'),
    feature: z.string().default('list-pr'),
    pr_folder_template: z.string().default('{repoSlug}_PR-{prId}')
  }).default({}),
  module_rules: z.record(z.array(z.string())).default({
    'Database & Entity Models': ['**/*Context.cs', '**/Entities/**/*.cs', '**/Models/**/*.cs', '**/*.sql', '**/migrations/**'],
    'APIs & Controllers': ['**/*Controller.cs', '**/Controllers/**/*.cs', '**/Routes/**/*.ts', '**/routes/**/*.js', '**/api/**/*.go'],
    'Services & Business Logic': ['**/*Service.cs', '**/Services/**/*.cs', '**/usecases/**', '**/domain/**'],
    'gRPC & External Integrations': ['**/*.proto', '**/*ProtoService.cs', '**/clients/**'],
    'Infrastructure & Unit Tests': ['**/*Test.cs', '**/*Tests.cs', '**/*.spec.ts', '**/*.test.ts', '**/Extensions/*.cs', '**/utils/**']
  })
});

export const ReadProfileSchema = z.object({
  auth: z.object({
    type: z.enum(['api_token', 'basic']).default('api_token'),
    email_env: z.string().default('BITBUCKET_EMAIL'),
    token_env: z.string().default('BITBUCKET_READ_TOKEN')
  }).default({}),
  capabilities: z.array(z.string()).default(['pr.read', 'repository.read'])
});

export const WriteProfileSchema = z.object({
  enabled: z.boolean().default(false),
  auth: z.object({
    type: z.enum(['api_token', 'basic']).default('api_token'),
    email_env: z.string().default('BITBUCKET_EMAIL'),
    token_env: z.string().default('BITBUCKET_WRITE_TOKEN')
  }).default({}),
  allow: z.array(z.string()).default(['pr.comment']),
  deny: z.array(z.string()).default(['pr.approve', 'pr.decline', 'pr.merge', 'repository.push']),
  require_confirmation: z.boolean().default(true)
});

// Legacy backward-compatibility config.json schema
export const LegacyConfigSchema = z.object({
  ticket_prefix: z.array(z.string()).optional(),
  output_language: z.enum(['vi', 'en', 'bilingual']).optional(),
  default_target_branch: z.string().optional(),
  default_pr_url: z.string().optional(),
  bitbucket: z.object({
    workspace: z.string().optional(),
    username: z.string().optional(),
    app_password: z.string().optional(),
    default_pr_url: z.string().optional()
  }).optional(),
  module_rules: z.record(z.array(z.string())).optional()
});

export type BaseConfig = z.infer<typeof BaseConfigSchema>;
export type ReadProfile = z.infer<typeof ReadProfileSchema>;
export type WriteProfile = z.infer<typeof WriteProfileSchema>;
export type LegacyConfig = z.infer<typeof LegacyConfigSchema>;

// Maintain Config alias for backward compatibility
export type Config = BaseConfig & {
  bitbucket?: {
    workspace?: string;
    username?: string;
    app_password?: string;
    default_pr_url?: string;
  };
};
