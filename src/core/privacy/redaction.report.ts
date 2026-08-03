export interface RedactionReport {
  mode: string;
  pii_removed: boolean;
  secrets_scanned: boolean;
  paths_sanitized: boolean;
  content_omitted_files: number;
  redacted_values: number;
  categories: string[];
}

export class RedactionTracker {
  private count = 0;
  private categoriesSet = new Set<string>();
  private contentOmittedFilesCount = 0;

  recordRedaction(category: string, count = 1): void {
    this.count += count;
    this.categoriesSet.add(category);
  }

  recordOmittedFile(): void {
    this.contentOmittedFilesCount++;
  }

  getReport(mode: string, piiRemoved = true, secretsScanned = true, pathsSanitized = true): RedactionReport {
    return {
      mode,
      pii_removed: piiRemoved,
      secrets_scanned: secretsScanned,
      paths_sanitized: pathsSanitized,
      content_omitted_files: this.contentOmittedFilesCount,
      redacted_values: this.count,
      categories: Array.from(this.categoriesSet).sort()
    };
  }
}
