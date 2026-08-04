import fs from 'fs';
import path from 'path';
import { RuntimeSession } from './runtime-session.js';
import { AccountPolicy } from './account-policy.js';
import { normalizeUuid } from './current-user.resolver.js';

export interface PersistedSessionData {
  session: RuntimeSession;
  createdAt: number;
}

export class SessionStore {
  private static storageDir = path.resolve(process.cwd(), '.mcp-pr-companion');
  private static sessionFile = path.join(SessionStore.storageDir, 'session.json');
  public static readonly SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

  private static ensureDir(): void {
    if (!fs.existsSync(this.storageDir)) {
      fs.mkdirSync(this.storageDir, { recursive: true });
    }
  }

  public static isExpired(createdAt: number): boolean {
    if (!createdAt || typeof createdAt !== 'number') return true;
    const age = Date.now() - createdAt;
    return age < 0 || age >= this.SESSION_TTL_MS;
  }

  public static saveSession(session: RuntimeSession): void {
    this.ensureDir();
    const data: PersistedSessionData = {
      session,
      createdAt: Date.now()
    };
    try {
      fs.writeFileSync(this.sessionFile, JSON.stringify(data, null, 2), 'utf-8');
    } catch {
      // Ignore write errors to prevent breaking runtime
    }
  }

  public static loadValidSession(): { session: RuntimeSession; remainingMinutes: number } | null {
    if (!fs.existsSync(this.sessionFile)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.sessionFile, 'utf-8');
      const parsed: PersistedSessionData = JSON.parse(raw);

      if (!parsed || !parsed.session || !parsed.createdAt) {
        this.clearSession();
        return null;
      }

      if (this.isExpired(parsed.createdAt)) {
        // Auto-purge expired session file
        this.clearSession();
        return null;
      }

      const normEmail = AccountPolicy.normalizeEmail(parsed.session.email);
      const normUuid = normalizeUuid(parsed.session.currentUserUuid);

      if (!normEmail || !normUuid || !parsed.session.token) {
        this.clearSession();
        return null;
      }

      const elapsedMs = Date.now() - parsed.createdAt;
      const remainingMs = Math.max(0, this.SESSION_TTL_MS - elapsedMs);
      const remainingMinutes = Math.ceil(remainingMs / (60 * 1000));

      return {
        session: {
          ...parsed.session,
          email: normEmail,
          currentUserUuid: normUuid
        },
        remainingMinutes
      };
    } catch {
      this.clearSession();
      return null;
    }
  }

  public static clearSession(): void {
    if (fs.existsSync(this.sessionFile)) {
      try {
        fs.unlinkSync(this.sessionFile);
      } catch {
        // Ignore deletion errors
      }
    }
  }
}
