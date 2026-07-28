import { z } from 'zod';
import { PayloadBuilder } from '../../core/generator/payload.builder.js';
import { Logger } from '../../utils/logger.js';

export const GeneratePRPayloadSchema = z.object({
  pr_url: z.string().optional().describe('Full URL to Bitbucket PR (e.g. https://bitbucket.org/workspace/repo/pull-requests/123).'),
  source_branch: z.string().optional().describe('Source branch (e.g. feature/WCE-815-staging). Defaults to current active branch.'),
  target_branch: z.string().optional().describe('Target branch (e.g. main or release/staging). Defaults to configured target branch.'),
  repo_path: z.string().optional().describe('Absolute path to target Git repository. Defaults to current working directory.')
});

export async function handleGeneratePRPayload(args: unknown) {
  const parsedArgs = GeneratePRPayloadSchema.parse(args || {});
  Logger.info(`Handling generate_pr_payload request. PR URL: ${parsedArgs.pr_url || 'N/A'}, Source: ${parsedArgs.source_branch || 'HEAD'}, Target: ${parsedArgs.target_branch || 'default'}`);

  const payload = await PayloadBuilder.build({
    prUrl: parsedArgs.pr_url,
    sourceBranch: parsedArgs.source_branch,
    targetBranch: parsedArgs.target_branch,
    repoPath: parsedArgs.repo_path
  });

  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(payload, null, 2)
      }
    ]
  };
}
