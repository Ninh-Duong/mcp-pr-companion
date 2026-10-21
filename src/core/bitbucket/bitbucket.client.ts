import { ApiTokenAuth } from '../auth/api-token.auth.js';
import { PaginationHelper, PaginatedResult } from './pagination.js';
import { SecretScanner } from '../privacy/secret.scanner.js';
import { fetchWithRetry } from './http.js';

export interface BitbucketFetchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class BitbucketClient {
  constructor(private email?: string, private token?: string) {}

  private get headers(): Record<string, string> {
    return ApiTokenAuth.getAuthHeaders(this.email ?? '', this.token ?? '');
  }

  async getPRMetadata(workspace: string, repoSlug: string, prId: number, options: BitbucketFetchOptions = {}): Promise<any> {
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests/${prId}`;
    return this.fetchJson(url, options);
  }

  async getPRCommits(workspace: string, repoSlug: string, prId: number, options: BitbucketFetchOptions = {}): Promise<PaginatedResult<any>> {
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests/${prId}/commits`;
    return PaginationHelper.fetchAllPages(url, this.headers, options);
  }

  async getPRDiffstat(workspace: string, repoSlug: string, prId: number, options: BitbucketFetchOptions = {}): Promise<PaginatedResult<any>> {
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests/${prId}/diffstat`;
    return PaginationHelper.fetchAllPages(url, this.headers, options);
  }

  /** Every comment of a PR (general and inline), all pages. */
  async getPRComments(workspace: string, repoSlug: string, prId: number, options: BitbucketFetchOptions = {}): Promise<PaginatedResult<any>> {
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests/${prId}/comments?pagelen=100`;
    return PaginationHelper.fetchAllPages(url, this.headers, options);
  }

  /** Repository details (needs read:repository); its uuid is the ai-context key material. */
  async getRepository(workspace: string, repoSlug: string, options: BitbucketFetchOptions = {}): Promise<any> {
    return this.fetchJson(`https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}`, options);
  }

  /** The authenticated account (needs read:user). Used as a credentials check. */
  async getCurrentUser(options: BitbucketFetchOptions = {}): Promise<any> {
    return this.fetchJson('https://api.bitbucket.org/2.0/user', options);
  }

  /** Every page of a pull request listing, newest first. */
  async listPullRequests(workspace: string, repoSlug: string, q: string, state?: string, options: BitbucketFetchOptions = {}): Promise<PaginatedResult<any>> {
    const params = new URLSearchParams({ sort: '-updated_on', pagelen: '50' });
    if (q) params.set('q', q);
    if (state) params.set('state', state);
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests?${params}`;
    return PaginationHelper.fetchAllPages(url, this.headers, { ...options, maxPages: Infinity });
  }

  async getPRDiffText(workspace: string, repoSlug: string, prId: number, options: BitbucketFetchOptions = {}): Promise<string> {
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests/${prId}/diff`;
    try {
      const res = await fetchWithRetry(url, { ...this.headers, Accept: 'text/plain' }, { timeoutMs: options.timeoutMs || 45000, signal: options.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      return await res.text();
    } catch (err: any) {
      throw new Error(`Failed to download PR diff: ${SecretScanner.scanAndRedact(err.message || String(err))}`);
    }
  }

  private async fetchJson(url: string, options: BitbucketFetchOptions = {}): Promise<any> {
    const res = await fetchWithRetry(url, this.headers, options);
    if (!res.ok) {
      const err: any = new Error(`HTTP ${res.status}: ${res.statusText}`);
      err.status = res.status;
      err.body = SecretScanner.scanAndRedact(await res.text());
      throw err;
    }
    return await res.json();
  }
}
