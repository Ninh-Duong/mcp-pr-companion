export class RetryPolicy {
  static shouldRetry(status?: number): boolean {
    if (!status) return true; // Network timeouts/resets
    if (status === 429) return true;
    if (status >= 500 && status <= 599) return true;
    return false; // Do not retry 400, 401, 403, 404
  }

  static async executeWithRetry<T>(
    fn: (attempt: number) => Promise<T>,
    maxRetries = 3,
    signal?: AbortSignal
  ): Promise<T> {
    let attempt = 0;
    while (attempt <= maxRetries) {
      if (signal?.aborted) {
        throw new Error('Sync operation cancelled by user.');
      }
      attempt++;
      try {
        return await fn(attempt);
      } catch (err: any) {
        const status = err?.status;
        const isLastAttempt = attempt > maxRetries;

        if (isLastAttempt || !this.shouldRetry(status)) {
          throw err;
        }

        // Calculate backoff: 1s, 2s, 4s + random jitter (100-500ms)
        let delayMs = Math.pow(2, attempt - 1) * 1000 + Math.floor(Math.random() * 400);

        // Check if Retry-After header exists
        if (err?.headers && typeof err.headers.get === 'function') {
          const retryAfter = err.headers.get('Retry-After');
          if (retryAfter) {
            const parsedSec = parseInt(retryAfter, 10);
            if (!isNaN(parsedSec)) {
              delayMs = parsedSec * 1000;
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
    throw new Error('Retry limit exceeded');
  }
}
