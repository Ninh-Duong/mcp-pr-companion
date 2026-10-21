import fs from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PRContextService, Page } from './context.service.js';
import { Logger } from '../utils/logger.js';
import { SecretScanner } from '../core/privacy/secret.scanner.js';
import { BitbucketCollector } from '../core/bitbucket/bitbucket.collector.js';

const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));

export const INSTRUCTIONS = `mcp-pr-companion provides sanitized Bitbucket PR context.
1. Start with get_pr_context_pack(pr_url). It syncs a missing or stale PR and retries pending status-folder migration, then returns a summary and Read Strategy.
2. Use search_pr_files(pr_url, filters) to find file ids; read one with get_pr_file_context or get_pr_file_changes.
3. Use get_pr_comments(pr_url) for review feedback; include_resolved=false shows open threads only.
Re-review: open only ids in the pack's "Changed since last sync" section.
No PR URL? list_my_open_prs finds the account's open PRs; list_synced_prs lists cached PRs by status. sync_my_open_prs syncs open PRs; show its prs as a table.
The cache is encrypted. Never read ai-context/ files directly. "No access: …" means the access check failed.
Page long text with next_offset or "continue with offset N".
Paths are sanitized; filter on values returned by search_pr_files. Tools never write to Bitbucket.
check_bitbucket_connection checks credentials and the account allowlist; local cache reads also require access to that repository.`;

const prUrl = z.string().min(1).describe('Full Bitbucket Cloud PR URL: https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}');
const fileId = z.union([z.string(), z.number().int().nonnegative()]).describe('File id from the context pack or search_pr_files, e.g. "file_0001" (a number such as 1 also works).');
const offset = z.number().int().min(0).default(0).describe('Character offset to start from. Use next_offset from the previous page.');
const maxChars = z.number().int().min(500).max(100_000).default(16_000).describe('Maximum characters to return in this page.');

// Reads the local (encrypted) revision; open world because each call first unlocks the repository with a live Bitbucket check.
const LOCAL_READ = { readOnlyHint: true, openWorldHint: true } as const;

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

/** Wraps every tool body: errors become isError results prefixed "Error:"; logs carry the tool name and error type only. */
async function run(tool: string, body: () => Promise<string> | string): Promise<ToolResult> {
  try {
    return { content: [{ type: 'text', text: await body() }] };
  } catch (err) {
    Logger.warn(`tool_failed tool=${tool} type=${err instanceof Error ? err.name : typeof err}`);
    const message = SecretScanner.scanAndRedact(err instanceof Error ? err.message : String(err));
    return { isError: true, content: [{ type: 'text', text: `Error: ${message}` }] };
  }
}

const json = (value: unknown) => JSON.stringify(value);
const withHint = (p: Page) => (p.next_offset === null ? p.text : `${p.text}\n\n… ${p.total_chars} chars in total; continue with offset ${p.next_offset}.`);

export function createServer(): McpServer {
  const server = new McpServer({ name: 'mcp-pr-companion', version }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'get_pr_context_pack',
    {
      title: 'PR context pack',
      description:
        'START HERE. Returns the Markdown context pack for a Bitbucket PR: overview, change summary, description, commits and a Read Strategy naming the files to open next. Syncs from Bitbucket when the PR is not cached, its commits/state/draft flag changed, or storage migration is pending.',
      inputSchema: {
        pr_url: prUrl,
        refresh: z.boolean().default(false).describe('Force a full re-sync even if the cached revision looks current.'),
        include_file_table: z.boolean().default(false).describe('Append the table of every changed file (larger output).')
      },
      // Writes only the local ai-context cache; reads Bitbucket.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    ({ pr_url, refresh, include_file_table }) => run('get_pr_context_pack', () => PRContextService.getContextPack(pr_url, refresh, include_file_table))
  );

  server.registerTool(
    'search_pr_files',
    {
      title: 'Search PR files',
      description: 'Lists changed files of a synced PR, filtered by path substring, language, status, change_kind or risk_tag. Returns JSON {total, files}.',
      inputSchema: {
        pr_url: prUrl,
        path: z.string().optional().describe('Case-insensitive substring of the sanitized path.'),
        language: z.string().optional().describe('e.g. typescript, csharp, sql.'),
        status: z.enum(['added', 'modified', 'deleted', 'renamed']).optional(),
        change_kind: z.string().optional().describe('e.g. functional_logic, comment_only, configuration, test_only.'),
        risk_tag: z.string().optional().describe('e.g. public_api, auth_security, database_schema, secret_config.'),
        limit: z.number().int().min(1).max(200).default(50)
      },
      annotations: LOCAL_READ
    },
    ({ pr_url, ...filters }) => run('search_pr_files', async () => json(await PRContextService.searchPRFiles(pr_url, filters)))
  );

  server.registerTool(
    'get_pr_file_context',
    {
      title: 'PR file context',
      description: 'Markdown for one changed file of a synced PR: path, status, change kind, risk tags and the sanitized diff. Paged by offset/max_chars.',
      inputSchema: { pr_url: prUrl, file_id: fileId, offset, max_chars: maxChars },
      annotations: LOCAL_READ
    },
    ({ pr_url, file_id, offset, max_chars }) =>
      run('get_pr_file_context', async () => withHint(await PRContextService.getFileContext(pr_url, file_id, offset, max_chars)))
  );

  server.registerTool(
    'get_pr_file_changes',
    {
      title: 'PR file changes (JSON)',
      description:
        'JSON for one changed file of a synced PR: classification with evidence, risk level/tags/evidence, symbols, and optionally a page of the sanitized patch ({text, total_chars, next_offset}).',
      inputSchema: {
        pr_url: prUrl,
        file_id: fileId,
        include_patch: z.boolean().default(true),
        offset,
        max_chars: maxChars
      },
      annotations: LOCAL_READ
    },
    ({ pr_url, file_id, include_patch, offset, max_chars }) =>
      run('get_pr_file_changes', async () => json(await PRContextService.getFileChange(pr_url, file_id, include_patch, offset, max_chars)))
  );

  server.registerTool(
    'get_pr_comments',
    {
      title: 'PR comments',
      description:
        'Review comments of a Bitbucket PR, fetched live: general and inline (with file_id/path/line when the PR is synced), resolved flag, sanitized text. Paged by offset/limit. Returns JSON {total, complete, comments, next_offset}.',
      inputSchema: {
        pr_url: prUrl,
        include_resolved: z.boolean().default(true).describe('false = only unresolved threads.'),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(200).default(50)
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    ({ pr_url, ...opts }) => run('get_pr_comments', async () => json(await PRContextService.getComments(pr_url, opts)))
  );

  server.registerTool(
    'list_synced_prs',
    {
      title: 'List synced PRs',
      description:
        'Lists locally synced PRs after unlocking each repository with a live Bitbucket check. Optional status filters open, draft, merged or declined PRs. Returns paged JSON {total, prs:[{pr_url, repository, id, title, pr_status, updated_at}], next_offset}.',
      inputSchema: {
        repository: z.string().optional().describe('"workspace/repo"; omit to use BITBUCKET_REPOSITORY.'),
        status: z.enum(['open', 'draft', 'merged', 'declined']).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(200).default(50)
      },
      annotations: LOCAL_READ
    },
    ({ repository, status, offset, limit }) => run('list_synced_prs', async () => json(await PRContextService.listSyncedPRs(repository, status, offset, limit)))
  );

  server.registerTool(
    'list_my_open_prs',
    {
      title: 'My open PRs',
      description:
        'Open PRs authored by the configured Bitbucket account, in one repository or every repository listed in BITBUCKET_REPOSITORY. Returns JSON {total, prs:[{pr_url, repository, id, title, is_draft, source_branch, target_branch, updated_on, local}]}; local is missing | cached | outdated.',
      inputSchema: {
        repository: z.string().optional().describe('"workspace/repo"; omit to use BITBUCKET_REPOSITORY.')
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    ({ repository }) => run('list_my_open_prs', async () => json(await PRContextService.listMyOpenPRs(repository)))
  );

  server.registerTool(
    'sync_my_open_prs',
    {
      title: 'Sync my open PRs',
      description:
        'Syncs every open PR authored by the configured account in one repository (or every BITBUCKET_REPOSITORY entry) into the encrypted local cache, skipping PRs whose commits, state, draft flag, and storage location match unless force. Returns JSON {total, synced, unchanged, failed, prs:[{pr_url, id, title, status, ticket, overall_risk, files_changed, updated_on, error?}]}: show it to the user as a table.',
      inputSchema: {
        repository: z.string().optional().describe('"workspace/repo"; omit to use BITBUCKET_REPOSITORY.'),
        force: z.boolean().default(false).describe('Re-sync every PR even if its commits did not move.')
      },
      // Writes only the local ai-context cache; reads Bitbucket.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }
    },
    ({ repository, force }) => run('sync_my_open_prs', async () => json(await PRContextService.syncMyOpenPRs(repository, force)))
  );

  server.registerTool(
    'check_bitbucket_connection',
    {
      title: 'Check Bitbucket connection',
      description:
        'Health check: verifies that the configured Bitbucket credentials authenticate (and pass ALLOWED_EMAILS) with one read-only request. Returns JSON {connected: true}; failures are errors. Changes nothing.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    () =>
      run('check_bitbucket_connection', async () => {
        await new BitbucketCollector().checkConnection();
        return json({ connected: true });
      })
  );

  server.registerTool(
    'get_pr_sync_status',
    {
      title: 'PR sync status',
      description: 'Whether a PR is cached locally, its revision, PR status, sync time, source/target commits and stats. Does not fetch the PR (only the access check that unlocks the encrypted cache).',
      inputSchema: { pr_url: prUrl },
      annotations: LOCAL_READ
    },
    ({ pr_url }) => run('get_pr_sync_status', async () => json(await PRContextService.getSyncStatus(pr_url)))
  );

  return server;
}
