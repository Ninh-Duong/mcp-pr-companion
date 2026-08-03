import { execFileSync } from 'child_process';
import { Logger } from '../../utils/logger.js';

export interface GitDiffStat {
  totalFilesChanged: number;
  totalAdditions: number;
  totalDeletions: number;
}

export class GitExecutor {
  constructor(private repoPath: string = process.cwd()) {}

  getCurrentBranch(): string {
    try {
      return this.runGit(['rev-parse', '--abbrev-ref', 'HEAD']);
    } catch (err) {
      Logger.error('Failed to get current git branch', err);
      return '';
    }
  }

  getAuthorName(): string {
    try {
      return this.runGit(['config', 'user.email']) || this.runGit(['config', 'user.name']);
    } catch (err) {
      return '';
    }
  }

  getCommits(sourceBranch: string, targetBranch: string): string[] {
    try {
      const rawCommits = this.runGit(['log', `${targetBranch}..${sourceBranch}`, '--no-merges', '--pretty=format:%s']);
      if (!rawCommits) return [];
      return rawCommits.split('\n').map(c => c.trim()).filter(Boolean);
    } catch (err) {
      Logger.warn(`Failed to get commits between ${targetBranch} and ${sourceBranch}`, err);
      return [];
    }
  }

  getDiffStat(sourceBranch: string, targetBranch: string): GitDiffStat {
    try {
      const rawStat = this.runGit(['diff', `${targetBranch}..${sourceBranch}`, '--shortstat']);
      if (!rawStat) return { totalFilesChanged: 0, totalAdditions: 0, totalDeletions: 0 };

      // Example output: "12 files changed, 450 insertions(+), 60 deletions(-)"
      const filesMatch = rawStat.match(/(\d+)\s+file/);
      const addMatch = rawStat.match(/(\d+)\s+insertion/);
      const delMatch = rawStat.match(/(\d+)\s+deletion/);

      return {
        totalFilesChanged: filesMatch ? parseInt(filesMatch[1], 10) : 0,
        totalAdditions: addMatch ? parseInt(addMatch[1], 10) : 0,
        totalDeletions: delMatch ? parseInt(delMatch[1], 10) : 0
      };
    } catch (err) {
      Logger.warn('Failed to parse git diff stat', err);
      return { totalFilesChanged: 0, totalAdditions: 0, totalDeletions: 0 };
    }
  }

  getChangedFiles(sourceBranch: string, targetBranch: string): string[] {
    try {
      const rawFiles = this.runGit(['diff', `${targetBranch}..${sourceBranch}`, '--name-only']);
      if (!rawFiles) return [];
      return rawFiles.split('\n').map(f => f.trim()).filter(Boolean);
    } catch (err) {
      Logger.warn('Failed to get changed files list', err);
      return [];
    }
  }

  getRawDiff(sourceBranch: string, targetBranch: string): string {
    try {
      return this.runGit(['diff', `${targetBranch}..${sourceBranch}`, '--unified=3']);
    } catch (err) {
      Logger.warn('Failed to fetch raw diff', err);
      return '';
    }
  }

  private runGit(args: string[]): string {
    return execFileSync('git', args, { cwd: this.repoPath, encoding: 'utf-8' }).trim();
  }
}

