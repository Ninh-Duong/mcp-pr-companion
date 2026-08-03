import { ApiTokenAuth } from './api-token.auth.js';

export interface BitbucketUser {
  uuid: string;
  display_name?: string;
  username?: string;
  account_id?: string;
}

export class CurrentUserResolver {
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
      if (!data.uuid) {
        return { success: false, error: 'User endpoint did not return an account UUID' };
      }

      return {
        success: true,
        user: {
          uuid: data.uuid,
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
