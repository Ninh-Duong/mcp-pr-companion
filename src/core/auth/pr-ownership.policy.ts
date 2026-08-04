import { normalizeUuid } from './current-user.resolver.js';

export class PROwnershipPolicy {
  /**
   * Checks if a PR's author UUID matches the authenticated current user UUID.
   * Both UUIDs are normalized (stripped of {} braces and lowercased).
   */
  static belongsToUser(prAuthorUuid: string | null | undefined, currentUserUuid: string): boolean {
    const normAuthor = normalizeUuid(prAuthorUuid);
    const normUser = normalizeUuid(currentUserUuid);

    if (!normAuthor || !normUser) {
      return false;
    }

    return normAuthor === normUser;
  }

  static assertOwnedByCurrentUser(prAuthorUuid: string | null | undefined, currentUserUuid: string): void {
    if (!this.belongsToUser(prAuthorUuid, currentUserUuid)) {
      throw new Error(`Security Violation: PR does not belong to the current authenticated user (Author UUID: ${prAuthorUuid || 'N/A'}, Current User UUID: ${currentUserUuid})`);
    }
  }
}
