import path from 'path';
import { PRStorageStatus, PR_STORAGE_STATUSES } from '../pr-status.js';

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
    root?: string,
    status?: PRStorageStatus
  ): string {
    const repositoryDir = this.getBitbucketRepositoryDir(workspace, repoSlug, company, root);
    return status
      ? path.join(repositoryDir, status, `pr_${prId}`)
      : path.join(repositoryDir, `pr_${prId}`);
  }

  public static getBitbucketRepositoryDir(workspace: string, repoSlug: string, company?: string, root?: string): string {
    const baseRoot = this.resolveRoot(root);
    const companySegment = company?.trim();
    if (companySegment) {
      return path.join(baseRoot, companySegment, workspace, repoSlug);
    }
    return path.join(baseRoot, workspace, repoSlug);
  }

  public static getBitbucketPRDirs(workspace: string, repoSlug: string, prId: number, company?: string, root?: string): string[] {
    return [
      ...PR_STORAGE_STATUSES.map(status => this.getBitbucketPRDir(workspace, repoSlug, prId, company, root, status)),
      this.getBitbucketPRDir(workspace, repoSlug, prId, company, root)
    ];
  }
}
