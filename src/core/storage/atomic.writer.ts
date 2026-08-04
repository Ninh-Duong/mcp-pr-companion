import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

export class AtomicWriter {
  /**
   * Writes text/JSON atomically using temp file + rename.
   */
  static writeFileSync(targetPath: string, data: string | Buffer): void {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tempPath = `${targetPath}.tmp-${Math.random().toString(36).substring(2, 9)}`;
    const fd = fs.openSync(tempPath, 'w');

    try {
      if (typeof data === 'string') {
        fs.writeFileSync(fd, data, 'utf-8');
      } else {
        fs.writeFileSync(fd, data);
      }
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    fs.renameSync(tempPath, targetPath);
  }

  /**
   * Writes JSON object atomically.
   */
  static writeJson(targetPath: string, data: any): void {
    this.writeFileSync(targetPath, JSON.stringify(data, null, 2));
  }

  /**
   * Writes gzipped data atomically.
   */
  static writeGzipSync(targetPath: string, content: string | Buffer): void {
    const compressed = zlib.gzipSync(content);
    this.writeFileSync(targetPath, compressed);
  }

  /**
   * Reads gzipped file content as string.
   */
  static readGzipSync(targetPath: string): string {
    const compressed = fs.readFileSync(targetPath);
    const decompressed = zlib.gunzipSync(compressed);
    return decompressed.toString('utf-8');
  }
}
