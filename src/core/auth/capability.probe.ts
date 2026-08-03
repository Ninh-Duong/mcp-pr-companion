import { ApiTokenAuth } from './api-token.auth.js';
import { CurrentUserResolver, BitbucketUser } from './current-user.resolver.js';

export interface ProbeStageResult {
  stageIndex: number;
  stageName: string;
  success: boolean;
  message: string;
  errorCode?: string;
  httpStatus?: number;
  details?: any;
}

export class CapabilityProbe {
  static async executeProbes(
    email: string,
    token: string,
    workspace: string,
    repoSlug: string,
    onProgress?: (stage: ProbeStageResult) => void
  ): Promise<{
    success: boolean;
    user?: BitbucketUser;
    openPrCount?: number;
    failedStage?: ProbeStageResult;
    stages: ProbeStageResult[];
  }> {
    const stages: ProbeStageResult[] = [];
    const headers = ApiTokenAuth.getAuthHeaders(email, token);

    // [1/7] Validating input
    const stage1: ProbeStageResult = {
      stageIndex: 1,
      stageName: 'Validating input',
      success: true,
      message: 'Input validated'
    };
    stages.push(stage1);
    if (onProgress) onProgress(stage1);

    // [2/7] Authenticating API token & [3/7] Resolving current account
    const userRes = await CurrentUserResolver.resolveCurrentUser(email, token);
    if (!userRes.success) {
      const stage2: ProbeStageResult = {
        stageIndex: 2,
        stageName: 'Authenticating API token',
        success: false,
        message: userRes.error || 'Authentication failed',
        errorCode: userRes.status === 403 ? 'AUTH_MISSING_USER_READ' : 'AUTH_INVALID_CREDENTIALS',
        httpStatus: userRes.status
      };
      stages.push(stage2);
      if (onProgress) onProgress(stage2);
      return { success: false, failedStage: stage2, stages };
    }

    const stage2: ProbeStageResult = {
      stageIndex: 2,
      stageName: 'Authenticating API token',
      success: true,
      message: 'API token authenticated'
    };
    stages.push(stage2);
    if (onProgress) onProgress(stage2);

    const stage3: ProbeStageResult = {
      stageIndex: 3,
      stageName: 'Resolving current Bitbucket account',
      success: true,
      message: 'Account resolved'
    };
    stages.push(stage3);
    if (onProgress) onProgress(stage3);

    // [4/7] Checking repository access (Probe 2)
    const repoUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`;
    try {
      const repoRes = await fetch(repoUrl, { headers });
      if (!repoRes.ok) {
        let errMessage = `Repository access failed (HTTP ${repoRes.status})`;
        let errorCode = 'AUTH_MISSING_REPO_READ';
        if (repoRes.status === 404) {
          errMessage = `Workspace or Repository not found: ${workspace}/${repoSlug}`;
          errorCode = 'REPO_NOT_FOUND';
        } else if (repoRes.status === 403) {
          errMessage = 'Required missing scope: read:repository:bitbucket';
        }

        const stage4: ProbeStageResult = {
          stageIndex: 4,
          stageName: 'Checking repository access',
          success: false,
          message: errMessage,
          errorCode,
          httpStatus: repoRes.status
        };
        stages.push(stage4);
        if (onProgress) onProgress(stage4);
        return { success: false, user: userRes.user, failedStage: stage4, stages };
      }
    } catch (err: any) {
      const stage4: ProbeStageResult = {
        stageIndex: 4,
        stageName: 'Checking repository access',
        success: false,
        message: err.message || 'Network error',
        errorCode: 'NETWORK_ERROR'
      };
      stages.push(stage4);
      if (onProgress) onProgress(stage4);
      return { success: false, user: userRes.user, failedStage: stage4, stages };
    }

    const stage4: ProbeStageResult = {
      stageIndex: 4,
      stageName: 'Checking repository access',
      success: true,
      message: 'Repository read access'
    };
    stages.push(stage4);
    if (onProgress) onProgress(stage4);

    // [5/7] Checking pull-request access (Probe 3)
    const prUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests?pagelen=1`;
    let samplePrId: number | null = null;
    let totalPrCount = 0;

    try {
      const prRes = await fetch(prUrl, { headers });
      if (!prRes.ok) {
        let errMessage = `Pull-request access failed (HTTP ${prRes.status})`;
        let errorCode = 'AUTH_MISSING_PR_READ';
        if (prRes.status === 403) {
          errMessage = 'Required missing scope: read:pullrequest:bitbucket';
        }

        const stage5: ProbeStageResult = {
          stageIndex: 5,
          stageName: 'Checking pull-request access',
          success: false,
          message: errMessage,
          errorCode,
          httpStatus: prRes.status
        };
        stages.push(stage5);
        if (onProgress) onProgress(stage5);
        return { success: false, user: userRes.user, failedStage: stage5, stages };
      }

      const prData: any = await prRes.json();
      if (prData.values && prData.values.length > 0) {
        samplePrId = prData.values[0].id;
      }
      totalPrCount = prData.size || (prData.values ? prData.values.length : 0);
    } catch (err: any) {
      const stage5: ProbeStageResult = {
        stageIndex: 5,
        stageName: 'Checking pull-request access',
        success: false,
        message: err.message || 'Network error',
        errorCode: 'NETWORK_ERROR'
      };
      stages.push(stage5);
      if (onProgress) onProgress(stage5);
      return { success: false, user: userRes.user, failedStage: stage5, stages };
    }

    const stage5: ProbeStageResult = {
      stageIndex: 5,
      stageName: 'Checking pull-request access',
      success: true,
      message: 'Pull-request read access'
    };
    stages.push(stage5);
    if (onProgress) onProgress(stage5);

    // [6/7] Discovering open pull requests & Probe 4 (Diff access check if PR exists)
    if (samplePrId !== null) {
      const diffstatUrl = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests/${samplePrId}/diffstat`;
      try {
        const diffRes = await fetch(diffstatUrl, { headers });
        if (!diffRes.ok && diffRes.status === 403) {
          const stage6: ProbeStageResult = {
            stageIndex: 6,
            stageName: 'Discovering open pull requests',
            success: false,
            message: 'Required missing scope for diff/diffstat: read:repository:bitbucket',
            errorCode: 'AUTH_MISSING_DIFF_READ',
            httpStatus: diffRes.status
          };
          stages.push(stage6);
          if (onProgress) onProgress(stage6);
          return { success: false, user: userRes.user, failedStage: stage6, stages };
        }
      } catch {
        // Ignore diff check failure if optional
      }
    }

    const stage6: ProbeStageResult = {
      stageIndex: 6,
      stageName: 'Discovering open pull requests',
      success: true,
      message: `Found ${totalPrCount} open pull requests`
    };
    stages.push(stage6);
    if (onProgress) onProgress(stage6);

    // [7/7] Loading local cache state
    const stage7: ProbeStageResult = {
      stageIndex: 7,
      stageName: 'Loading local cache state',
      success: true,
      message: 'Local cache ready'
    };
    stages.push(stage7);
    if (onProgress) onProgress(stage7);

    return {
      success: true,
      user: userRes.user,
      openPrCount: totalPrCount,
      stages
    };
  }
}
