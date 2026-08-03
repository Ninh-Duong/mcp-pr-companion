import { ConfigManager } from '../../config/config.manager.js';
import { OpaqueIDGenerator } from '../storage/opaque.id.js';
import { CapabilityProbe } from './capability.probe.js';
import { FileLogger } from '../logging/file.logger.js';
import { runtimeSession, RuntimeSession } from './runtime-session.js';

export interface RepositoryParseResult {
  valid: boolean;
  workspace?: string;
  repoSlug?: string;
  error?: string;
  suggestion?: string;
}

export class AuthService {
  static parseRepositoryInput(input: string): RepositoryParseResult {
    if (!input || !input.trim()) {
      return { valid: false, error: 'Repository cannot be empty.' };
    }

    const trimmed = input.trim();

    // Check typo like comma instead of dot (e.g. wec,be -> wec.be)
    if (trimmed.includes(',')) {
      const suggestion = trimmed.replace(/,/g, '.');
      return {
        valid: false,
        error: `Invalid repository: ${trimmed}`,
        suggestion: `Did you mean: ${suggestion}?`
      };
    }

    const parts = trimmed.split('/');
    if (parts.length === 2) {
      const workspace = parts[0].trim().toLowerCase();
      const repoSlug = parts[1].trim().toLowerCase();
      if (!workspace || !repoSlug) {
        return { valid: false, error: 'Both workspace and repository slug must be non-empty.' };
      }
      return { valid: true, workspace, repoSlug };
    } else if (parts.length === 1) {
      const repoSlug = parts[0].trim().toLowerCase();
      // Try to load default workspace from base config
      try {
        const baseConfig = ConfigManager.loadBase();
        if (baseConfig && baseConfig.workspace) {
          return { valid: true, workspace: baseConfig.workspace.toLowerCase(), repoSlug };
        }
      } catch {
        // Ignore
      }
      return {
        valid: false,
        error: `Repository must be in format "workspace/repository". Default workspace is not configured in base config.`
      };
    } else {
      return { valid: false, error: 'Invalid repository format. Expected "workspace/repository".' };
    }
  }

  static async authenticateAndProbe(
    email: string,
    repositoryInput: string,
    token: string,
    onProgress?: (stageName: string, success: boolean, message: string) => void
  ): Promise<{
    success: boolean;
    session?: RuntimeSession;
    logFilePath: string;
    error?: string;
    suggestion?: string;
  }> {
    const repoParse = this.parseRepositoryInput(repositoryInput);
    if (!repoParse.valid || !repoParse.workspace || !repoParse.repoSlug) {
      const logger = new FileLogger('auth');
      logger.log({
        stage: 'input_validation',
        status: 'failed',
        error_code: 'INVALID_REPOSITORY_INPUT',
        message: repoParse.error
      });
      return {
        success: false,
        logFilePath: logger.getLogFilePath(),
        error: repoParse.error,
        suggestion: repoParse.suggestion
      };
    }

    const { workspace, repoSlug } = repoParse;
    const logger = new FileLogger('auth', workspace, repoSlug);
    logger.log({ stage: 'input_validation', status: 'success' });

    const probeResult = await CapabilityProbe.executeProbes(
      email,
      token,
      workspace,
      repoSlug,
      (stage) => {
        logger.log({
          stage: stage.stageName.toLowerCase().replace(/\s+/g, '_'),
          status: stage.success ? 'success' : 'failed',
          error_code: stage.errorCode,
          http_status: stage.httpStatus,
          message: stage.message
        });
        if (onProgress) {
          onProgress(stage.stageName, stage.success, stage.message);
        }
      }
    );

    if (!probeResult.success || !probeResult.user) {
      const failed = probeResult.failedStage;
      logger.log({
        stage: 'validation_completed',
        status: 'failed',
        error_code: failed?.errorCode || 'AUTH_FAILED',
        http_status: failed?.httpStatus
      });
      return {
        success: false,
        logFilePath: logger.getLogFilePath(),
        error: failed?.message || 'Authentication failed'
      };
    }

    const opaqueId = OpaqueIDGenerator.getRepositoryID(workspace, repoSlug);
    const session: RuntimeSession = {
      email,
      token,
      currentUserUuid: probeResult.user.uuid,
      displayName: probeResult.user.display_name,
      repository: {
        workspace,
        repoSlug,
        opaqueId
      },
      capabilities: {
        tokenAuthenticated: true,
        userAccess: true,
        repoRead: true,
        prRead: true,
        diffRead: true
      }
    };

    runtimeSession.setSession(session);
    logger.log({ stage: 'session_ready', status: 'success' });

    return {
      success: true,
      session,
      logFilePath: logger.getLogFilePath()
    };
  }
}
