import path from 'path';

export class StorePathResolver {
  public static readonly DEFAULT_ROOT = 'ai-context';
  public static readonly DEFAULT_COMPANY = 'default';
  public static readonly DEFAULT_APP = 'mcp-pr-companion';
  public static readonly DEFAULT_FEATURE = 'pr';

  public static resolveRoot(root?: string): string {
    const configuredRoot = root?.trim() || StorePathResolver.DEFAULT_ROOT;
    return path.isAbsolute(configuredRoot)
      ? path.normalize(configuredRoot)
      : path.resolve(process.cwd(), configuredRoot);
  }

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
    const baseRoot = this.resolveRoot(root);
    const companySegment = company?.trim();
    if (companySegment) {
      return path.join(baseRoot, companySegment, workspace, repoSlug, `pr_${prId}`);
    }
    return path.join(baseRoot, workspace, repoSlug, `pr_${prId}`);
  }
}
