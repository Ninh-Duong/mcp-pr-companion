import { fetchWithRetry } from './http.js';

export interface PaginatedResult<T> {
  values: T[];
  isComplete: boolean;
  warnings: string[];
}

export class PaginationHelper {
  static async fetchAllPages<T>(
    initialUrl: string,
    headers: Record<string, string>,
    options: { maxPages?: number; timeoutMs?: number; signal?: AbortSignal } = {}
  ): Promise<PaginatedResult<T>> {
    const values: T[] = [];
    const warnings: string[] = [];
    let nextUrl: string | undefined = initialUrl;
    let pageCount = 0;
    const maxPages = options.maxPages || 50; // Safety guard limit
    const visited = new Set<string>();

    while (nextUrl && pageCount < maxPages) {
      if (visited.has(nextUrl)) {
        warnings.push('Pagination stopped: Bitbucket repeated a page URL.');
        return { values, isComplete: false, warnings };
      }
      visited.add(nextUrl);
      if (options.signal?.aborted) {
        warnings.push('Fetch aborted during pagination.');
        return { values, isComplete: false, warnings };
      }

      pageCount++;
      try {
        const res = await fetchWithRetry(nextUrl, headers, options);

        if (!res.ok) {
          const errText = await res.text();
          warnings.push(`Pagination stopped at page ${pageCount}: HTTP ${res.status} (${errText.substring(0, 100)})`);
          return { values, isComplete: false, warnings };
        }

        const data: any = await res.json();
        if (Array.isArray(data.values)) {
          values.push(...data.values);
        }

        nextUrl = data.next ? String(data.next) : undefined;
        // Never send the Authorization header to a host other than the one we started on.
        if (nextUrl && new URL(nextUrl, initialUrl).origin !== new URL(initialUrl).origin) {
          warnings.push(`Pagination stopped: next page points to a different host.`);
          return { values, isComplete: false, warnings };
        }
      } catch (err: any) {
        warnings.push(`Pagination error on page ${pageCount}: ${err.message || String(err)}`);
        return { values, isComplete: false, warnings };
      }
    }

    return {
      values,
      isComplete: !nextUrl,
      warnings
    };
  }
}
