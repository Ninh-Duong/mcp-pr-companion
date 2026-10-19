import fs from 'fs';
import path from 'path';
import { isEncrypted } from './secure-file.js';

/**
 * Deletes every file under root that is not in the encrypted PRC1 format (data written before
 * encryption), then removes folders left empty. No key or network needed: ai-context/ is a cache
 * and the next sync rewrites it encrypted. Returns the number of files deleted.
 */
export function purgePlaintext(root: string): number {
  if (!fs.existsSync(root)) return 0;
  let deleted = 0;
  const walk = (dir: string): boolean => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (walk(full)) fs.rmdirSync(full);
      } else {
        const fd = fs.openSync(full, 'r');
        const head = Buffer.alloc(5);
        const read = fs.readSync(fd, head, 0, 5, 0);
        fs.closeSync(fd);
        if (!isEncrypted(head.subarray(0, read))) {
          fs.rmSync(full, { force: true });
          deleted++;
        }
      }
    }
    return fs.readdirSync(dir).length === 0;
  };
  walk(root);
  return deleted;
}
