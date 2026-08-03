import fs from 'fs';
import path from 'path';
import { Redactor } from '../utils/redactor.js';

export interface Credentials {
  email?: string;
  readToken?: string;
  writeToken?: string;
}

export class SecretStore {
  private static secretsDir = path.resolve(process.cwd(), '.mcp-pr-companion', 'secrets');
  private static secretsFile = path.join(SecretStore.secretsDir, 'credentials.env');

  static getCredentials(): Credentials {
    // 1. First check environment variables
    let email = process.env.BITBUCKET_EMAIL;
    let readToken = process.env.BITBUCKET_READ_TOKEN;
    let writeToken = process.env.BITBUCKET_WRITE_TOKEN;

    // 2. Fall back to credentials.env file
    if (fs.existsSync(this.secretsFile)) {
      try {
        const content = fs.readFileSync(this.secretsFile, 'utf-8');
        const lines = content.split('\n');
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const [key, ...valParts] = trimmed.split('=');
          const value = valParts.join('=').trim().replace(/^["']|["']$/g, '');
          if (key.trim() === 'BITBUCKET_EMAIL' && !email) {
            email = value;
          } else if (key.trim() === 'BITBUCKET_READ_TOKEN' && !readToken) {
            readToken = value;
          } else if (key.trim() === 'BITBUCKET_WRITE_TOKEN' && !writeToken) {
            writeToken = value;
          }
        }
      } catch (err) {
        // Ignore file read error, fall back to empty
      }
    }

    return { email, readToken, writeToken };
  }

  static saveCredentials(creds: Partial<Credentials>): void {
    if (!fs.existsSync(this.secretsDir)) {
      fs.mkdirSync(this.secretsDir, { recursive: true });
    }

    const current = this.getCredentials();
    const updated: Credentials = {
      email: creds.email !== undefined ? creds.email : current.email,
      readToken: creds.readToken !== undefined ? creds.readToken : current.readToken,
      writeToken: creds.writeToken !== undefined ? creds.writeToken : current.writeToken
    };

    const lines = [
      '# Local MCP PR Companion Credentials',
      `BITBUCKET_EMAIL=${updated.email || ''}`,
      `BITBUCKET_READ_TOKEN=${updated.readToken || ''}`,
      `BITBUCKET_WRITE_TOKEN=${updated.writeToken || ''}`
    ];

    fs.writeFileSync(this.secretsFile, lines.join('\n'), 'utf-8');
  }

  static getMaskedSummary(): { email: string; readToken: string; writeToken: string } {
    const creds = this.getCredentials();
    return {
      email: creds.email || 'Not configured',
      readToken: creds.readToken ? Redactor.maskToken(creds.readToken) : 'Not configured',
      writeToken: creds.writeToken ? Redactor.maskToken(creds.writeToken) : 'Not configured'
    };
  }
}
