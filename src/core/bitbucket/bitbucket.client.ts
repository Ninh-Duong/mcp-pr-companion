import { BitbucketAuth } from './bitbucket.auth.js';
import { PaginationHelper, PaginatedResult } from './pagination.js';
import { Redactor } from '../../utils/redactor.js';

export interface BitbucketFetchOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export class BitbucketClient {
  constructor(private email?: string, private token?: string) {}

  private get headers(): Record<string, string> {
    return BitbucketAuth.getAuthHeaders(this.email, this.token);
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

  async getPRDiffText(workspace: string, repoSlug: string, prId: number, options: BitbucketFetchOptions = {}): Promise<string> {
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repoSlug)}/pullrequests/${prId}/diff`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 45000);

    try {
      const fetchSignal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;

      const diffHeaders = {
        ...this.headers,
        'Accept': 'text/plain'
      };

      const res = await fetch(url, { headers: diffHeaders, signal: fetchSignal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      return await res.text();
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw new Error(`Failed to download PR diff: ${Redactor.redact(err.message || String(err))}`);
    }
  }

  private async fetchJson(url: string, options: BitbucketFetchOptions = {}): Promise<any> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeoutMs || 30000);

    try {
      const fetchSignal = options.signal
        ? AbortSignal.any([options.signal, controller.signal])
        : controller.signal;

      const res = await fetch(url, { headers: this.headers, signal: fetchSignal });
      clearTimeout(timeoutId);

      if (!res.ok) {
        const errBody = await res.text();
        const redactedErr = Redactor.redact(errBody);
        const err: any = new Error(`HTTP ${res.status}: ${res.statusText}`);
        err.status = res.status;
        err.body = redactedErr;
        throw err;
      }

      return await res.json();
    } catch (err: any) {
      clearTimeout(timeoutId);
      throw err;
    }
  }
}
