import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AtomicWriter } from './atomic.writer.js';

export class OpaqueIDGenerator {
  private static saltFile = path.resolve(process.cwd(), '.mcp-pr-companion', 'prs', 'salt.key');
  private static registryFile = path.resolve(process.cwd(), '.mcp-pr-companion', 'prs', 'registry.enc.json');

  private static getSalt(): string {
    const dir = path.dirname(this.saltFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    if (fs.existsSync(this.saltFile)) {
      return fs.readFileSync(this.saltFile, 'utf-8').trim();
    }

    const salt = crypto.randomBytes(16).toString('hex');
    AtomicWriter.writeFileSync(this.saltFile, salt);
    return salt;
  }

  static getRepositoryID(workspace: string, repoSlug: string): string {
    const salt = this.getSalt();
    const input = `${workspace.toLowerCase()}/${repoSlug.toLowerCase()}:${salt}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex').substring(0, 8);
    const repoId = `repo_${hash}`;

    // Store mapping in local registry
    this.updateRegistryMapping(repoId, workspace, repoSlug);
    return repoId;
  }

  static getRevisionID(sourceHash: string, destinationHash: string, schemaVersion = '3.0'): string {
    const input = `${sourceHash}:${destinationHash}:${schemaVersion}`;
    const hash = crypto.createHash('sha256').update(input).digest('hex').substring(0, 12);
    return `rev_${hash}`;
  }

  private static updateRegistryMapping(repoId: string, workspace: string, repoSlug: string): void {
    const dir = path.dirname(this.registryFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    let registry: Record<string, { workspace: string; repoSlug: string; updated_at: string }> = {};
    if (fs.existsSync(this.registryFile)) {
      try {
        registry = JSON.parse(fs.readFileSync(this.registryFile, 'utf-8'));
      } catch {
        registry = {};
      }
    }

    registry[repoId] = {
      workspace,
      repoSlug,
      updated_at: new Date().toISOString()
    };

    AtomicWriter.writeFileSync(this.registryFile, JSON.stringify(registry, null, 2));
  }

  static resolveRepository(repoId: string): { workspace: string; repoSlug: string } | null {
    if (!fs.existsSync(this.registryFile)) return null;

    try {
      const registry = JSON.parse(fs.readFileSync(this.registryFile, 'utf-8'));
      return registry[repoId] || null;
    } catch {
      return null;
    }
  }
}
