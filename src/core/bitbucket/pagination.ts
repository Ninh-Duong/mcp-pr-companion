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

    while (nextUrl && pageCount < maxPages) {
      if (options.signal?.aborted) {
        warnings.push('Fetch aborted during pagination.');
        return { values, isComplete: false, warnings };
      }

      pageCount++;
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 30000);

      try {
        const fetchSignal = options.signal
          ? AbortSignal.any([options.signal, controller.signal])
          : controller.signal;

        const res = await fetch(nextUrl, { headers, signal: fetchSignal });
        clearTimeout(timeoutId);

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
      } catch (err: any) {
        clearTimeout(timeoutId);
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
