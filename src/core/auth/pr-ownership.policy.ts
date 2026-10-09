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

}
