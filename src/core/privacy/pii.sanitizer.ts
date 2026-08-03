import { RedactionTracker } from './redaction.report.js';

export class PIISanitizer {
  /**
   * Cleans text content from emails, UUIDs, and raw HTML tags.
   */
  static sanitizeText(text: string, tracker?: RedactionTracker): string {
    if (!text) return '';

    let clean = text;

    // Remove email patterns
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    if (emailRegex.test(clean)) {
      if (tracker) tracker.recordRedaction('pii_email');
      clean = clean.replace(emailRegex, '[REDACTED:EMAIL]');
    }

    // Remove UUID patterns (e.g. {12345678-1234-1234-1234-1234567890ab})
    const uuidRegex = /\{?[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\}?/g;
    if (uuidRegex.test(clean)) {
      if (tracker) tracker.recordRedaction('pii_uuid');
      clean = clean.replace(uuidRegex, '[REDACTED:UUID]');
    }

    // Strip HTML markup
    clean = clean.replace(/<[^>]*>/g, '');

    return clean;
  }

  /**
   * Sanitizes user/author metadata according to privacy policy.
   */
  static sanitizeAuthor(authorObj: any, removeAuthor = true, tracker?: RedactionTracker): { display_name?: string } | null {
    if (!authorObj) return null;

    if (tracker) {
      if (authorObj.raw || authorObj.account_id || authorObj.uuid || authorObj.nickname || authorObj.email) {
        tracker.recordRedaction('pii_user_identity');
      }
    }

    if (removeAuthor) {
      return null;
    }

    const displayName = authorObj.display_name || authorObj.username;
    if (displayName) {
      return { display_name: this.sanitizeText(displayName, tracker) };
    }

    return null;
  }
}
