import path from 'path';

export type FilePathMode = 'full' | 'sanitized' | 'basename' | 'opaque';

export class PathSanitizer {
  static sanitize(filePath: string, mode: FilePathMode = 'sanitized', fileId = 'file_0001'): string {
    if (!filePath) return fileId;

    const normalized = filePath.replace(/\\/g, '/');

    switch (mode) {
      case 'full':
        return normalized;
      case 'basename':
        return path.basename(normalized);
      case 'opaque':
        return fileId;
      case 'sanitized':
      default: {
        const parts = normalized.split('/').filter(Boolean);
        if (parts.length <= 3) {
          return parts.join('/');
        }
        // Keep first segment and last two segments (e.g. src/.../Controllers/CRCController.cs)
        const first = parts[0];
        const lastTwo = parts.slice(-2).join('/');
        return `${first}/.../${lastTwo}`;
      }
    }
  }
}
