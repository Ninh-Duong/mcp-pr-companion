import path from 'path';

export class StorePathResolver {
  public static readonly DEFAULT_ROOT = 'ai-context';

  public static resolveRoot(root?: string): string {
    const configuredRoot = root?.trim() || StorePathResolver.DEFAULT_ROOT;
    return path.isAbsolute(configuredRoot)
      ? path.normalize(configuredRoot)
      : path.resolve(process.cwd(), configuredRoot);
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
