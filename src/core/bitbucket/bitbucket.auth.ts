import { Redactor } from '../../utils/redactor.js';

export class BitbucketAuth {
  static getAuthHeaders(email?: string, token?: string): Record<string, string> {
    if (!token) {
      throw new Error('Bitbucket read API Token is required for API requests.');
    }

    let authValue: string;
    // If email is provided, use Basic Auth base64(email:token) as required by Bitbucket API Tokens
    if (email && email.trim()) {
      const authStr = `${email.trim()}:${token.trim()}`;
      authValue = `Basic ${Buffer.from(authStr).toString('base64')}`;
    } else {
      authValue = `Bearer ${token.trim()}`;
    }

    return {
      'Authorization': authValue,
      'Accept': 'application/json'
    };
  }

  static getMaskedAuthSummary(email?: string, token?: string): string {
    return `Email: ${email || 'N/A'}, Token: ${token ? Redactor.maskToken(token) : 'N/A'}`;
  }
}
