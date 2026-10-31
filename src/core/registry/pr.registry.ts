export interface ParsedPRUrl {
  workspace: string;
  repoSlug: string;
  prId: number;
  canonicalUrl: string;
}

export class PRRegistry {
  static parseAndValidateUrl(urlInput: string): ParsedPRUrl {
    if (!urlInput || typeof urlInput !== 'string') {
      throw new Error('PR URL must be a non-empty string.');
    }

    if (urlInput.includes('..')) {
      throw new Error('Path traversal sequence ".." detected in URL.');
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(urlInput.trim());
    } catch {
      throw new Error(`Invalid URL format: "${urlInput}"`);
    }

    if (parsedUrl.protocol !== 'https:') {
      throw new Error(`Insecure protocol: PR URL must start with https://`);
    }

    if (parsedUrl.hostname.toLowerCase() !== 'bitbucket.org') {
      throw new Error(`Invalid host: PR URL hostname must be bitbucket.org (got ${parsedUrl.hostname})`);
    }

    // Path must match /workspace/repo/pull-requests/id
    const pathname = parsedUrl.pathname.replace(/\/$/, '');
    // A URL copied from any PR tab works: …/pull-requests/7/overview, /diff, /commits, /activity.
    const match = pathname.match(/^\/([^\/]+)\/([^\/]+)\/pull-requests\/(\d+)(?:\/(?:overview|diff|commits|activity))?$/i);

    if (!match) {
      throw new Error(`Invalid Bitbucket PR URL path structure. Expected: https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`);
    }

    // Bitbucket slugs are case-insensitive: one case means one folder and one in-flight sync per PR.
    const workspace = match[1].toLowerCase();
    const repoSlug = match[2].toLowerCase();
    const prId = Number(match[3]);

    const slugRegex = /^[a-zA-Z0-9_\-\.]+$/;
    if (!slugRegex.test(workspace) || !slugRegex.test(repoSlug)) {
      throw new Error(`Invalid workspace or repository name in PR URL. Slugs must contain only letters, numbers, hyphens, underscores, or dots.`);
    }

    if (!Number.isSafeInteger(prId) || prId <= 0) {
      throw new Error(`Invalid PR ID number: ${match[3]}`);
    }

    // Canonicalize URL (no query params, no fragments, normalized path)
    const canonicalUrl = `https://bitbucket.org/${workspace.toLowerCase()}/${repoSlug.toLowerCase()}/pull-requests/${prId}`;

    return {
      workspace,
      repoSlug,
      prId,
      canonicalUrl
    };
  }
}
