import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { AtomicWriter } from './atomic.writer.js';

export class OpaqueIDGenerator {
  private static saltFile = path.resolve(process.cwd(), '.mcp-pr-companion', 'prs', 'salt.key');

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
    return `repo_${hash}`;
  }
}
