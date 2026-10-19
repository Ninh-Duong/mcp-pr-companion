export class GitParser {
  /**
   * Ticket id for the PR. Configured prefixes are tried in branch, title, then commits. As a fallback,
   * a generic KEY-123 is accepted only where it is clearly a ticket: a branch segment ("feature/WC-36-x")
   * or a bracketed / leading token in the title ("[WC-36] …", "WC-36: …"). Commits are excluded from the
   * fallback so that "UTF-8" or "SHA-256" in a message never becomes a ticket.
   */
  static extractTicketId(sourceBranch: string, commits: string[], ticketPrefixes: string[], title = ''): string {
    for (const text of [sourceBranch, title, ...commits]) {
      for (const prefix of ticketPrefixes) {
        const match = text.match(new RegExp(`(${prefix}\\d+)`, 'i'));
        if (match) return match[1].toUpperCase();
      }
    }

    const generic =
      sourceBranch.match(/(?:^|\/)([A-Z][A-Z0-9]+-\d+)/) ||
      title.match(/\[([A-Z][A-Z0-9]+-\d+)\]/) ||
      title.match(/^([A-Z][A-Z0-9]+-\d+)\b/);
    return generic ? generic[1] : 'N/A';
  }
}
