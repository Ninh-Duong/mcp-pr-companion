import path from 'path';

export class StorePathResolver {
  public static readonly DEFAULT_COMPANY = 'default';
  public static readonly DEFAULT_APP = 'mcp-pr-companion';
  public static readonly DEFAULT_FEATURE = 'pr';

  public static getPRFolderName(repoSlug: string, prId: number): string {
    return `${repoSlug}_pr_${prId}`;
  }

  public static getBitbucketPRDir(
    workspace: string,
    repoSlug: string,
    prId: number,
    company?: string,
    root?: string
  ): string {
    const baseRoot = root || path.resolve(process.cwd(), 'output');
    if (company) {
      return path.join(baseRoot, company, workspace, repoSlug, `pr_${prId}`);
    }
    return path.join(baseRoot, workspace, repoSlug, `pr_${prId}`);
  }
}
