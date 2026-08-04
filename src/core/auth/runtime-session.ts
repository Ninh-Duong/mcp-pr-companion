import { AccountPolicy } from './account-policy.js';
import { normalizeUuid } from './current-user.resolver.js';
import { SessionStore } from './session.store.js';

export interface RepositoryLocator {
  workspace: string;
  repoSlug: string;
  opaqueId: string;
}

export interface CapabilityResult {
  tokenAuthenticated: boolean;
  userAccess: boolean;
  repoRead: boolean;
  prRead: boolean;
  diffRead: boolean;
  missingScope?: string;
  error?: string;
}

export interface RuntimeSession {
  email: string;
  token: string;
  currentUserUuid: string;
  displayName?: string;
  repository: RepositoryLocator;
  capabilities: CapabilityResult;
}

class RuntimeSessionManager {
  private session: RuntimeSession | null = null;

  public getSession(): RuntimeSession | null {
    return this.session;
  }

  public getAuthenticatedIdentity(): { email: string; token: string; currentUserUuid: string } {
    if (!this.session || !this.session.email || !this.session.token || !this.session.currentUserUuid) {
      throw new Error('Authentication Error: No active authenticated session with valid user UUID found.');
    }
    const normEmail = AccountPolicy.normalizeEmail(this.session.email);
    const normUuid = normalizeUuid(this.session.currentUserUuid);
    if (!normEmail || !normUuid) {
      throw new Error('Authentication Error: Session email or user UUID is invalid or empty.');
    }
    return {
      email: normEmail,
      token: this.session.token,
      currentUserUuid: normUuid
    };
  }

  public setSession(session: RuntimeSession): void {
    const normEmail = AccountPolicy.normalizeEmail(session.email);
    const normUuid = normalizeUuid(session.currentUserUuid);
    if (!normUuid) {
      throw new Error('RuntimeSession Error: Cannot set session with empty or invalid currentUserUuid.');
    }
    this.session = {
      ...session,
      email: normEmail,
      currentUserUuid: normUuid
    };
  }

  public clear(): void {
    if (this.session) {
      this.session.email = '';
      this.session.token = '';
      this.session.currentUserUuid = '';
      this.session.displayName = '';
      this.session = null;
    }
    SessionStore.clearSession();
  }

  public isAuthenticated(): boolean {
    return !!(this.session && this.session.token && this.session.currentUserUuid);
  }
}

export const runtimeSession = new RuntimeSessionManager();
