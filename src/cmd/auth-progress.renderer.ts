import { ProbeStageResult } from '../core/auth/capability.probe.js';

export class AuthProgressRenderer {
  static renderInitial(): void {
    console.log('\nValidating session...');
    console.log('[1/7] … Validating input');
    console.log('[2/7] … Authenticating API token');
    console.log('[3/7] … Resolving current Bitbucket account');
    console.log('[4/7] … Checking repository access');
    console.log('[5/7] … Checking pull-request access');
    console.log('[6/7] … Discovering open pull requests');
    console.log('[7/7] … Loading local cache state\n');
  }

  static renderStage(stage: ProbeStageResult): void {
    const symbol = stage.success ? '✓' : '✗';
    console.log(`[${stage.stageIndex}/7] ${symbol} ${stage.message}`);
  }

  static renderFailureSummary(failedStage: ProbeStageResult, logFilePath: string): void {
    console.log('\nValidation failed');
    console.log(`✗ ${failedStage.stageName}`);
    console.log(`Reason: ${failedStage.message}`);
    if (failedStage.errorCode) {
      console.log(`Error Code: ${failedStage.errorCode}`);
    }
    console.log(`Log: ${logFilePath}\n`);
  }
}
