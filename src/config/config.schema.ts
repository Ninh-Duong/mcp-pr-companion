import { z } from 'zod';

export const ConfigSchema = z.object({
  ticket_prefix: z.array(z.string()).default(['WCE-', 'PROJ-', 'JIRA-']),
  output_language: z.enum(['vi', 'en', 'bilingual']).default('vi'),
  default_target_branch: z.string().default('main'),
  default_pr_url: z.string().optional().default(''),
  
  // Credentials & Tokens for Bitbucket / GitHub API Integration
  bitbucket: z.object({
    workspace: z.string().optional().default(''),
    username: z.string().optional().default(''),
    app_password: z.string().optional().default(''),
    default_pr_url: z.string().optional().default('')
  }).optional().default({}),

  github: z.object({
    token: z.string().optional().default('')
  }).optional().default({}),

  module_rules: z.record(z.array(z.string())).default({
    'Database & Entity Models': ['**/*Context.cs', '**/Entities/**/*.cs', '**/Models/**/*.cs', '**/*.sql', '**/migrations/**'],
    'APIs & Controllers': ['**/*Controller.cs', '**/Controllers/**/*.cs', '**/Routes/**/*.ts', '**/routes/**/*.js', '**/api/**/*.go'],
    'Services & Business Logic': ['**/*Service.cs', '**/Services/**/*.cs', '**/usecases/**', '**/domain/**'],
    'gRPC & External Integrations': ['**/*.proto', '**/*ProtoService.cs', '**/clients/**'],
    'Infrastructure & Unit Tests': ['**/*Test.cs', '**/*Tests.cs', '**/*.spec.ts', '**/*.test.ts', '**/Extensions/*.cs', '**/utils/**']
  })
});

export type Config = z.infer<typeof ConfigSchema>;
