import fs from 'fs';
import path from 'path';
import { ConfigManager } from '../../config/config.manager.js';
import { DataStore } from './data.store.js';
import { Logger } from '../../utils/logger.js';

export class RetentionService {
  static cleanOldRevisions(workspace: string, repoSlug: string, prId: number): { removedCount: number } {
    const config = ConfigManager.loadBase();
    const maxRevisions = config.cache.max_revisions_per_pr || 3;
    const retentionDays = config.cache.retention_days || 30;

    const prDir = DataStore.getPRDir(workspace, repoSlug, prId);
    const revisionsDir = path.join(prDir, 'revisions');

    if (!fs.existsSync(revisionsDir)) {
      return { removedCount: 0 };
    }

    const active = DataStore.getActiveRevision(workspace, repoSlug, prId);
    const activeSourceHash = active?.current?.source_hash;

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
        // Never delete active revision
        if (activeSourceHash && rev.folder === activeSourceHash) return;

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
    const logsDir = path.resolve(process.cwd(), '.mcp-pr-companion', 'logs');

    if (!fs.existsSync(logsDir)) {
      return { removedLogsCount: 0 };
    }

    let removedLogsCount = 0;
    const now = Date.now();
    const maxAgeMs = retentionDays * 24 * 60 * 60 * 1000;

    try {
      const entries = fs.readdirSync(logsDir, { recursive: true }) as string[];
      for (const entry of entries) {
        const fullPath = path.join(logsDir, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isFile() && (now - stat.mtimeMs) > maxAgeMs) {
          fs.rmSync(fullPath, { force: true });
          removedLogsCount++;
        }
      }
    } catch (err) {
      // Ignore
    }

    return { removedLogsCount };
  }
}
