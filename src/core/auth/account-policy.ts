export const ALLOWED_BITBUCKET_EMAIL = 'ninh.duong@siliconstack.com.au';

export class AccountPolicy {
  static normalizeEmail(email: string): string {
    return email ? email.trim().toLowerCase() : '';
  }

  static isEmailAllowed(email: string): boolean {
    const normalized = this.normalizeEmail(email);
    return normalized === ALLOWED_BITBUCKET_EMAIL;
  }

  static validateEmail(email: string): { allowed: boolean; reason?: string } {
    const normalized = this.normalizeEmail(email);
    if (!normalized) {
      return { allowed: false, reason: 'Email address cannot be empty.' };
    }
    if (!this.isEmailAllowed(normalized)) {
      return {
        allowed: false,
        reason: `Access denied. This CLI only supports account: ${ALLOWED_BITBUCKET_EMAIL}`
      };
    }
    return { allowed: true };
  }
}
