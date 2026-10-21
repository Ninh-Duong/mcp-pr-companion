import { BitbucketCollector } from '../bitbucket/bitbucket.collector.js';

/**
 * Releases the key material for a repository's ai-context files only after a live check:
 * the .env credentials authenticate, pass ALLOWED_EMAILS, and can read that repository.
 * The material (the repository UUID) lives in memory only, for TTL_MS, and is never logged or written.
 */
export class AccessGate {
  static readonly TTL_MS = 60_000;
  private static unlocked = new Map<string, { material: string; until: number }>();

  private static key(workspace: string, repoSlug: string): string {
    return `${workspace}/${repoSlug}`.toLowerCase();
  }

  /** Checks access against Bitbucket (cached for TTL_MS) and unlocks the repository. */
  static async unlock(workspace: string, repoSlug: string): Promise<void> {
    const cached = this.unlocked.get(this.key(workspace, repoSlug));
    if (cached && cached.until > Date.now()) return;

    let collector: BitbucketCollector;
    try {
      collector = new BitbucketCollector();
    } catch (err) {
      throw new Error(`No access: ${err instanceof Error ? err.message : String(err)}`);
    }
    const uuid = await collector.getRepositoryUuid(workspace, repoSlug);
    this.setMaterial(workspace, repoSlug, uuid);
  }

  /** The unlocked material, or a "No access" error. Synchronous so file readers/writers stay sync. */
  static material(workspace: string, repoSlug: string): string {
    const entry = this.unlocked.get(this.key(workspace, repoSlug));
    if (!entry || entry.until <= Date.now()) {
      this.unlocked.delete(this.key(workspace, repoSlug)); // do not keep expired key material in memory
      throw new Error(`No access: ${workspace}/${repoSlug} is locked. Its data is only readable after a successful Bitbucket check.`);
    }
    return entry.material;
  }

  /** Used by unlock(); tests call it directly instead of a network check. */
  static setMaterial(workspace: string, repoSlug: string, material: string): void {
    const normalized = material.replace(/[{}]/g, '').trim().toLowerCase();
    if (!normalized) throw new Error(`No access: Bitbucket returned no repository id for ${workspace}/${repoSlug}.`);
    this.unlocked.set(this.key(workspace, repoSlug), { material: normalized, until: Date.now() + this.TTL_MS });
  }

  static lockAll(): void {
    this.unlocked.clear();
  }
}
