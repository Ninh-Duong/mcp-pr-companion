import crypto from 'crypto';

export class StableSerializer {
  /**
   * Sorts object keys recursively to produce deterministic JSON string representation.
   */
  static stringify(obj: any): string {
    return JSON.stringify(this.sortObject(obj));
  }

  private static sortObject(obj: any): any {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.sortObject(item));
    }

    const sortedKeys = Object.keys(obj).sort();
    const sortedObj: Record<string, any> = {};

    for (const key of sortedKeys) {
      sortedObj[key] = this.sortObject(obj[key]);
    }

    return sortedObj;
  }

  /**
   * Calculates SHA-256 hash of object excluding volatile timestamp fields like generated_at.
   */
  static computeContentHash(manifestObj: any): string {
    const clone = JSON.parse(JSON.stringify(manifestObj));
    delete clone.generated_at;

    const stableStr = this.stringify(clone);
    return crypto.createHash('sha256').update(stableStr).digest('hex');
  }
}
