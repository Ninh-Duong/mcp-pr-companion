import path from 'path';

export class SensitiveFilePolicy {
  private static sensitivePatterns = [
    /^\.env(\..+)?$/i,
    /^appsettings.*\.json$/i,
    /^secrets.*\.json$/i,
    /^credentials.*$/i,
    /\.(pem|key|pfx|p12)$/i,
    /^id_rsa.*$/i,
    /connectionstrings\.json$/i
  ];

  static isSensitiveFile(filePath: string): boolean {
    if (!filePath) return false;
    const fileName = path.basename(filePath);

    for (const pattern of this.sensitivePatterns) {
      if (pattern.test(fileName)) {
        return true;
      }
    }
    return false;
  }
}
