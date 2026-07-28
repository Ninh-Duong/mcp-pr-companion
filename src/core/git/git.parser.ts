export class GitParser {
  static extractTicketId(sourceBranch: string, commits: string[], ticketPrefixes: string[]): string {
    // Search in branch name first
    for (const prefix of ticketPrefixes) {
      const regex = new RegExp(`(${prefix}\\d+)`, 'i');
      const branchMatch = sourceBranch.match(regex);
      if (branchMatch) {
        return branchMatch[1].toUpperCase();
      }
    }

    // Search in commit messages
    for (const commit of commits) {
      for (const prefix of ticketPrefixes) {
        const regex = new RegExp(`(${prefix}\\d+)`, 'i');
        const commitMatch = commit.match(regex);
        if (commitMatch) {
          return commitMatch[1].toUpperCase();
        }
      }
    }

    return 'N/A';
  }

  static generatePRTitle(sourceBranch: string, ticketId: string, commits: string[]): string {
    // If we have commits, use the most descriptive clean commit title
    if (commits.length > 0) {
      const firstCommit = commits[0];
      // Clean leading ticket ids if redundant
      const cleaned = firstCommit.replace(/^\[.*?\]\s*/, '').replace(/^wce-\d+:\s*/i, '');
      if (ticketId !== 'N/A') {
        return `[${ticketId}] ${cleaned}`;
      }
      return cleaned;
    }

    // Fallback: derive title from branch name
    const branchBasename = sourceBranch.split('/').pop() || sourceBranch;
    const readableTitle = branchBasename.replace(/[-_]/g, ' ');
    return ticketId !== 'N/A' ? `[${ticketId}] ${readableTitle}` : readableTitle;
  }
}
