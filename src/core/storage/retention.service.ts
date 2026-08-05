import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../../config/config.manager.js';
import { DataStore } from './data.store.js';
import { RevisionWriter } from '../output/revision.writer.js';
import { Logger } from '../../utils/logger.js';

export class RetentionService {
  static cleanOldRevisions(workspace: string, repoSlug: string, prId: number): { removedCount: number } {
    const config = ConfigManager.loadBase();
    const maxRevisions = config.cache.max_revisions_per_pr || 3;
    const retentionDays = config.cache.retention_days || 30;

    const prDir = RevisionWriter.getPROutputDir(
      workspace,
      repoSlug,
      prId,
      config.ai_context.company,
      config.ai_context.root
    );
    const revisionsDir = path.join(prDir, 'revisions');

    if (!fs.existsSync(revisionsDir)) {
      return { removedCount: 0 };
    }

    const active = DataStore.getActiveRevision(workspace, repoSlug, prId);
    const activeRevisionId = active?.current?.active_revision;

    let removedCount = 0;
    try {
      const revisionFolders = fs.readdirSync(revisionsDir).map(folder => {
        const fullPath = path.join(revisionsDir, folder);
        const stat = fs.statSync(fullPath);
        return {
          folder,
          fullPath,
          mtimeMs: stat.mtimeMs
        };
      });

      // Sort newest to oldest
      revisionFolders.sort((a, b) => b.mtimeMs - a.mtimeMs);

      const now = Date.now();
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

      revisionFolders.forEach((rev, index) => {
        // Never delete active revision or temporary staging folders currently writing
        if (rev.folder.startsWith('.tmp-')) return;
        if (activeRevisionId && rev.folder === activeRevisionId) return;

        const isExceedingCount = index >= maxRevisions;
        const isExpired = (now - rev.mtimeMs) > maxAgeMs;

        if (isExceedingCount || isExpired) {
          fs.rmSync(rev.fullPath, { recursive: true, force: true });
          removedCount++;
        }
      });
    } catch (err) {
      Logger.warn(`Failed during retention cleanup for ${workspace}/${repoSlug} PR #${prId}`, err);
    }

    return { removedCount };
  }

  static cleanLogs(): { removedLogsCount: number } {
    const config = ConfigManager.loadBase();
    const retentionDays = config.cache.retention_days || 30;
    const logsDir = path.resolve(process.cwd(), 'Logs');

    if (!fs.existsSync(logsDir)) {
      return { removedLogsCount: 0 };
    }

    let removedLogsCount = 0;
    try {
      const files = fs.readdirSync(logsDir);
      const now = Date.now();
      const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

      files.forEach(file => {
        const fullPath = path.join(logsDir, file);
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(fullPath);
          removedLogsCount++;
        }
      });
    } catch (err) {
      Logger.warn('Failed during logs cleanup', err);
    }

    return { removedLogsCount };
  }
}
