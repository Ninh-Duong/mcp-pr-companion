/**
 * The one place that calls fetch() for Bitbucket: per-attempt timeout, optional caller signal, and
 * up to 2 retries on 429 / 502 / 503 / 504 (honouring Retry-After, capped at 10 s; else 1 s, 3 s).
 * Returns the final Response (ok or not); throws only on network errors or abort.
 */
const RETRY_STATUS = new Set([429, 502, 503, 504]);
const BACKOFF_MS = [1000, 3000];
const MAX_RETRY_AFTER_MS = 10_000;

export interface HttpOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function retryDelay(res: Response, attempt: number): number {
  const header = Number(res.headers.get('retry-after'));
  return Number.isFinite(header) && header >= 0 ? Math.min(header * 1000, MAX_RETRY_AFTER_MS) : BACKOFF_MS[attempt];
}

export async function fetchWithRetry(url: string, headers: Record<string, string>, options: HttpOptions = {}): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const signal = AbortSignal.timeout(options.timeoutMs || 30000);
    const res = await fetch(url, { headers, signal: options.signal ? AbortSignal.any([options.signal, signal]) : signal });
    if (!RETRY_STATUS.has(res.status) || attempt >= BACKOFF_MS.length) return res;
    await res.body?.cancel();
    await sleep(retryDelay(res, attempt));
  }
}
