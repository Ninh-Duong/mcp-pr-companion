import { DiscoveredPR } from './pr-list.normalizer.js';
import { PROwnershipPolicy } from '../auth/pr-ownership.policy.js';
import { PRSyncMode } from '../pr-status.js';

export type PRReadinessFilter = 'ready' | 'draft' | 'all';

export interface PRDiscoveryFilterOptions {
  state: 'OPEN';
  readiness: PRReadinessFilter;
}

export class PRViewFilter {
  static matchesForSync(pr: DiscoveredPR, currentUserUuid: string, mode: PRSyncMode): boolean {
    if (!PROwnershipPolicy.belongsToUser(pr.authorUuid, currentUserUuid)) return false;
    const state = pr.state.toUpperCase();
    if (mode === 'all') return state === 'OPEN' || state === 'MERGED' || state === 'DECLINED';
    if (mode === 'open') return state === 'OPEN' && !pr.isDraft;
    if (mode === 'draft') return state === 'OPEN' && pr.isDraft;
    return state === mode.toUpperCase();
  }

  static applyForSync(prs: DiscoveredPR[], currentUserUuid: string, mode: PRSyncMode): DiscoveredPR[] {
    return prs.filter(pr => this.matchesForSync(pr, currentUserUuid, mode));
  }

  static matches(
    pr: DiscoveredPR,
    currentUserUuid: string,
    readiness: PRReadinessFilter = 'all'
  ): boolean {
    // 1. Mandatory ownership check
    if (!PROwnershipPolicy.belongsToUser(pr.authorUuid, currentUserUuid)) {
      return false;
    }

    // 2. Open state check
    if (pr.state.toUpperCase() !== 'OPEN') {
      return false;
    }

    // 3. Readiness check
    if (readiness === 'draft') {
      return pr.isDraft === true;
    }
    if (readiness === 'ready') {
      return pr.isDraft === false;
    }

    return true;
  }

  static apply(
    prs: DiscoveredPR[],
    currentUserUuid: string,
    readiness: PRReadinessFilter = 'all'
  ): DiscoveredPR[] {
    return prs.filter(pr => this.matches(pr, currentUserUuid, readiness));
  }
}
