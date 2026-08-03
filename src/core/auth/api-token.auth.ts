export class ApiTokenAuth {
  static getAuthHeaders(email: string, token: string): Record<string, string> {
    if (!token || !token.trim()) {
      throw new Error('API Token is missing.');
    }

    let authValue: string;
    if (email && email.trim()) {
      const credentials = `${email.trim()}:${token.trim()}`;
      authValue = `Basic ${Buffer.from(credentials).toString('base64')}`;
    } else {
      authValue = `Bearer ${token.trim()}`;
    }

    return {
      'Authorization': authValue,
      'Accept': 'application/json'
    };
  }
}
