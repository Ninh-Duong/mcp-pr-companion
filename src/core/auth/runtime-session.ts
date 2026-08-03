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

  public setSession(session: RuntimeSession): void {
    this.session = session;
  }

  public clear(): void {
    if (this.session) {
      this.session.email = '';
      this.session.token = '';
      this.session.currentUserUuid = '';
      this.session.displayName = '';
      this.session = null;
    }
  }

  public isAuthenticated(): boolean {
    return !!(this.session && this.session.token && this.session.currentUserUuid);
  }
}

export const runtimeSession = new RuntimeSessionManager();
