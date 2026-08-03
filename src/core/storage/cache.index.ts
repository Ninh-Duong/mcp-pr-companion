import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { AtomicWriter } from './atomic.writer.js';
import { BaseConfig } from '../../config/config.schema.js';

export interface CacheIndexEntry {
  cacheKey: string;
  provider: string;
  workspace: string;
  repoSlug: string;
  prId: number;
  sourceHash: string;
  destinationHash: string;
  revisionPath: string;
  lastCheckedAt: string;
  status: 'complete' | 'partial' | 'failed';
}

export class CacheIndex {
  private static stateDir = path.resolve(process.cwd(), '.mcp-pr-companion', 'state');
  private static indexFile = path.join(CacheIndex.stateDir, 'cache-index.json');

  static generateCacheKey(
    workspace: string,
    repoSlug: string,
    prId: number,
    sourceHash: string,
    destinationHash: string,
    config: BaseConfig
  ): string {
    const schemaVersion = 'v2';
    const configHash = crypto
      .createHash('md5')
      .update(JSON.stringify(config.module_rules || {}))
      .digest('hex')
      .substring(0, 8);

    return `bitbucket:${workspace.toLowerCase()}:${repoSlug.toLowerCase()}:${prId}:${sourceHash}:${destinationHash}:${schemaVersion}:${configHash}`;
  }

  static getIndex(): Record<string, CacheIndexEntry> {
    if (!fs.existsSync(this.indexFile)) {
      return {};
    }

    try {
      const raw = fs.readFileSync(this.indexFile, 'utf-8');
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }

  static getEntry(cacheKey: string): CacheIndexEntry | undefined {
    const index = this.getIndex();
    return index[cacheKey];
  }

  static updateEntry(entry: CacheIndexEntry): void {
    const index = this.getIndex();
    index[entry.cacheKey] = entry;
    AtomicWriter.writeFileSync(this.indexFile, JSON.stringify(index, null, 2));
  }
}
