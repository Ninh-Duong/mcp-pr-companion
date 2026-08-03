import fs from 'fs';
import path from 'path';

export class CacheMigrator {
  /**
   * Scans and purges legacy raw JSON files in output/ directory when strict privacy mode is active.
   */
  static purgeLegacyRawFiles(): number {
    const outputDir = path.resolve(process.cwd(), 'output');
    if (!fs.existsSync(outputDir)) return 0;

    let deletedCount = 0;
    try {
      const files = fs.readdirSync(outputDir);
      for (const file of files) {
        if (file.startsWith('raw_pr_') && file.endsWith('.json')) {
          fs.unlinkSync(path.join(outputDir, file));
          deletedCount++;
        }
      }
    } catch {
      // Ignore
    }

    return deletedCount;
  }
}
