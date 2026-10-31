import { ApiTokenAuth } from './api-token.auth.js';

export interface BitbucketUser {
  uuid: string;
  rawUuid: string;
  display_name?: string;
  username?: string;
  account_id?: string;
}

export function normalizeUuid(uuid: string | null | undefined): string {
  if (!uuid) return '';
  return uuid.replace(/[{}]/g, '').trim().toLowerCase();
}

export class CurrentUserResolver {
  static normalizeUuid(uuid: string | null | undefined): string {
    return normalizeUuid(uuid);
  }

  static async resolveCurrentUser(email: string, token: string): Promise<{ success: boolean; user?: BitbucketUser; error?: string; status?: number }> {
    const url = 'https://api.bitbucket.org/2.0/user';
    const headers = ApiTokenAuth.getAuthHeaders(email, token);

    try {
      const res = await fetch(url, { headers });
      if (!res.ok) {
        let errMessage = `HTTP ${res.status}: ${res.statusText}`;
        if (res.status === 401) errMessage = 'Email or API token invalid';
        if (res.status === 403) errMessage = 'Missing User Read scope (read:user:bitbucket)';
        return { success: false, status: res.status, error: errMessage };
      }

      const data: any = await res.json();
      const rawUuid = data.uuid;
      const normalized = normalizeUuid(rawUuid);
      if (!normalized) {
        return { success: false, error: 'User endpoint did not return a valid account UUID' };
      }

      return {
        success: true,
        user: {
          uuid: normalized,
          rawUuid: rawUuid || normalized,
          display_name: data.display_name || data.username || 'Authenticated User',
          username: data.username,
          account_id: data.account_id
        }
      };
    } catch (err: any) {
      return { success: false, error: err.message || 'Network timeout connecting to Bitbucket' };
    }
  }
}
