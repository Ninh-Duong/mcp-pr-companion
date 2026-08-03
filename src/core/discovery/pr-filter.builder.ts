export class PRFilterBuilder {
  static buildQuery(currentUserUuid?: string): string {
    const filters: string[] = ['state="OPEN"'];

    if (currentUserUuid) {
      // Bitbucket query syntax: author.uuid="{uuid}"
      const sanitizedUuid = currentUserUuid.replace(/[{}]/g, '');
      filters.push(`author.uuid="{${sanitizedUuid}}"`);
    }

    return filters.join(' AND ');
  }
}
