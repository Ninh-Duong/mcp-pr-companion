import { ConfigManager } from '../../config/config.manager.js';

export class AccountPolicy {
  static normalizeEmail(email: string): string {
    return email ? email.trim().toLowerCase() : '';
  }

  // Empty ALLOWED_EMAILS (.env or the Hub's bitbucket block) = any account is allowed.
  static isEmailAllowed(email: string, allowed: string[] = ConfigManager.loadBase().allowed_emails): boolean {
    if (allowed.length === 0) return true;
    const normalized = this.normalizeEmail(email);
    return allowed.some(a => this.normalizeEmail(a) === normalized);
  }

  static validateEmail(email: string): { allowed: boolean; reason?: string } {
    const normalized = this.normalizeEmail(email);
    if (!normalized) {
      return { allowed: false, reason: 'Email address cannot be empty.' };
    }
    if (!this.isEmailAllowed(normalized)) {
      return {
        allowed: false,
        reason: `Access denied. This account is not listed in ALLOWED_EMAILS (.env or the Hub's bitbucket block).`
      };
    }
    return { allowed: true };
  }
}
