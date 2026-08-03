import fs from 'fs';
import path from 'path';
import { Logger } from '../../utils/logger.js';

export interface PRRegistryData {
  schema_version: number;
  items: string[];
}

export interface ParsedPRUrl {
  workspace: string;
  repoSlug: string;
  prId: number;
  canonicalUrl: string;
}

export class PRRegistry {
  private static prsDir = path.resolve(process.cwd(), '.mcp-pr-companion', 'prs');
  private static linksFile = path.join(PRRegistry.prsDir, 'links.json');

  static ensureDirs(): void {
    if (!fs.existsSync(this.prsDir)) {
      fs.mkdirSync(this.prsDir, { recursive: true });
    }
  }

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
    const match = pathname.match(/^\/([^\/]+)\/([^\/]+)\/pull-requests\/(\d+)$/i);

    if (!match) {
      throw new Error(`Invalid Bitbucket PR URL path structure. Expected: https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}`);
    }

    const workspace = match[1];
    const repoSlug = match[2];
    const prId = parseInt(match[3], 10);

    const slugRegex = /^[a-zA-Z0-9_-]+$/;
    if (!slugRegex.test(workspace) || !slugRegex.test(repoSlug)) {
      throw new Error(`Invalid workspace or repository name in PR URL. Slugs must contain only letters, numbers, hyphens, or underscores.`);
    }

    if (isNaN(prId) || prId <= 0) {
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

  static list(): string[] {
    this.ensureDirs();
    if (!fs.existsSync(this.linksFile)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(this.linksFile, 'utf-8');
      const data: PRRegistryData = JSON.parse(raw);
      return Array.isArray(data.items) ? data.items : [];
    } catch (err) {
      Logger.warn(`Failed to read ${this.linksFile}, returning empty list.`, err);
      return [];
    }
  }

  static add(urlInput: string): { success: boolean; canonicalUrl: string; message: string } {
    const parsed = this.parseAndValidateUrl(urlInput);
    const items = this.list();

    if (items.includes(parsed.canonicalUrl)) {
      return {
        success: false,
        canonicalUrl: parsed.canonicalUrl,
        message: `PR link already exists in registry: ${parsed.canonicalUrl}`
      };
    }

    items.push(parsed.canonicalUrl);
    this.saveAtomic(items);

    return {
      success: true,
      canonicalUrl: parsed.canonicalUrl,
      message: `Successfully added PR link: ${parsed.canonicalUrl}`
    };
  }

  static remove(urlInput: string): { success: boolean; message: string } {
    let canonicalUrl: string;
    try {
      const parsed = this.parseAndValidateUrl(urlInput);
      canonicalUrl = parsed.canonicalUrl;
    } catch {
      canonicalUrl = urlInput.trim().toLowerCase();
    }

    const items = this.list();
    const index = items.indexOf(canonicalUrl);

    if (index === -1) {
      return { success: false, message: `PR link not found in registry: ${urlInput}` };
    }

    items.splice(index, 1);
    this.saveAtomic(items);

    return { success: true, message: `Removed PR link: ${canonicalUrl}` };
  }

  static clear(): void {
    this.saveAtomic([]);
  }

  static deduplicate(): { countBefore: number; countAfter: number; removed: number } {
    const items = this.list();
    const unique: string[] = [];
    for (const item of items) {
      try {
        const parsed = this.parseAndValidateUrl(item);
        if (!unique.includes(parsed.canonicalUrl)) {
          unique.push(parsed.canonicalUrl);
        }
      } catch {
        // Skip invalid items during deduplication
      }
    }

    const removed = items.length - unique.length;
    if (removed > 0) {
      this.saveAtomic(unique);
    }

    return {
      countBefore: items.length,
      countAfter: unique.length,
      removed
    };
  }

  static validateAll(): { valid: string[]; invalid: { url: string; error: string }[] } {
    const items = this.list();
    const valid: string[] = [];
    const invalid: { url: string; error: string }[] = [];

    for (const item of items) {
      try {
        const parsed = this.parseAndValidateUrl(item);
        valid.push(parsed.canonicalUrl);
      } catch (err: any) {
        invalid.push({ url: item, error: err.message || String(err) });
      }
    }

    return { valid, invalid };
  }

  private static saveAtomic(items: string[]): void {
    this.ensureDirs();
    const data: PRRegistryData = {
      schema_version: 1,
      items
    };

    const tempFile = `${this.linksFile}.tmp-${Math.random().toString(36).substring(2, 8)}`;
    fs.writeFileSync(tempFile, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tempFile, this.linksFile);
  }
}
