import { DiscoveredPR } from './pr-list.normalizer.js';
import { PROwnershipPolicy } from '../auth/pr-ownership.policy.js';

export type PRReadinessFilter = 'ready' | 'draft' | 'all';

export interface PRDiscoveryFilterOptions {
  state: 'OPEN';
  readiness: PRReadinessFilter;
}

export class PRViewFilter {
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
