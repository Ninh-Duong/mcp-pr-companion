import fs from 'fs';
import path from 'path';
import { OutputReader } from '../output/output.reader.js';
import { DiscoveredPR } from './pr-list.normalizer.js';
import { normalizeUuid } from '../auth/current-user.resolver.js';

export class DiscoveryCache {
  private static scopedMap = new Map<string, Map<number, DiscoveredPR>>();

  static getScopeKey(userUuid: string, workspace: string, repoSlug: string): string {
    const normUuid = normalizeUuid(userUuid);
    const normWs = workspace.trim().toLowerCase();
    const normRepo = repoSlug.trim().toLowerCase();
    return `${normUuid}:${normWs}:${normRepo}`;
  }

  static setPRs(userUuid: string, workspace: string, repoSlug: string, prs: DiscoveredPR[]): void {
    const key = this.getScopeKey(userUuid, workspace, repoSlug);
    const prMap = new Map<number, DiscoveredPR>();
    prs.forEach(pr => prMap.set(pr.id, pr));
    this.scopedMap.set(key, prMap);
  }

  static getPRs(userUuid: string, workspace: string, repoSlug: string): DiscoveredPR[] {
    const key = this.getScopeKey(userUuid, workspace, repoSlug);
    const prMap = this.scopedMap.get(key);
    return prMap ? Array.from(prMap.values()) : [];
  }

  /**
   * Local status without decrypting anything: a revision folder is named after the PR's source and
   * target commits (rev_<src7>_<dst7>), so its existence says whether the current commits are synced.
   */
  static evaluateCacheStatus(
    workspace: string,
    repoSlug: string,
    prId: number,
    _updatedOn: string,
    sourceCommitHash?: string,
    destinationCommitHash?: string
  ): 'Missing' | 'Cached' | 'Outdated' {
    const prDir = OutputReader.getPROutputDir(workspace, repoSlug, prId);
    if (!fs.existsSync(path.join(prDir, 'current.json'))) return 'Missing';
    if (!sourceCommitHash || !destinationCommitHash) return 'Outdated';
    const revision = `rev_${sourceCommitHash.substring(0, 7)}_${destinationCommitHash.substring(0, 7)}`;
    return fs.existsSync(path.join(prDir, 'revisions', revision)) ? 'Cached' : 'Outdated';
  }

  static clearScope(userUuid: string, workspace: string, repoSlug: string): void {
    const key = this.getScopeKey(userUuid, workspace, repoSlug);
    this.scopedMap.delete(key);
  }

  static clearAll(): void {
    this.scopedMap.clear();
  }

  static clear(): void {
    this.clearAll();
  }
}
