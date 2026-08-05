export class CacheMigrator {
  /**
   * Legacy raw payloads are no longer stored in a public export directory.
   */
  static purgeLegacyRawFiles(): number {
    return 0;
  }
}
