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

}
