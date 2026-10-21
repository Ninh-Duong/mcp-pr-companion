import { normalizeUuid } from '../auth/current-user.resolver.js';

export class PRFilterBuilder {
  static buildQuery(currentUserUuid: string): string {
    const normalized = normalizeUuid(currentUserUuid);
    if (!normalized) {
      throw new Error('Authenticated user UUID is required for PR discovery query generation.');
    }

    return `author.uuid="{${normalized}}"`;
  }
}
