import fs from 'fs';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { PRContextService, Page } from './context.service.js';
import { Logger } from '../utils/logger.js';
import { SecretScanner } from '../core/privacy/secret.scanner.js';

const { version } = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf-8'));

export const INSTRUCTIONS = `mcp-pr-companion: read-only, privacy-sanitized context for Bitbucket Cloud pull requests.
Workflow:
1. get_pr_context_pack(pr_url) first. It syncs the PR from Bitbucket when there is no local copy or the PR has new commits, then returns a compact Markdown summary with a Read Strategy listing the file ids worth opening.
2. search_pr_files(pr_url, filters) to list file ids by path, language, status, change_kind or risk_tag.
3. get_pr_file_context(pr_url, file_id) for one file's summary and diff, or get_pr_file_changes(pr_url, file_id) for classification, risk evidence and symbols as JSON.
Long text is paged: when next_offset is not null (or the text ends with "continue with offset N"), call again with that offset.
File paths are sanitized by design; filter on what search_pr_files returns. Tools never write to Bitbucket.`;

const prUrl = z.string().min(1).describe('Full Bitbucket Cloud PR URL: https://bitbucket.org/{workspace}/{repo}/pull-requests/{id}');
const fileId = z.union([z.string(), z.number().int().nonnegative()]).describe('File id from the context pack or search_pr_files, e.g. "file_0001" (a number such as 1 also works).');
const offset = z.number().int().min(0).default(0).describe('Character offset to start from. Use next_offset from the previous page.');
const maxChars = z.number().int().min(500).max(100_000).default(16_000).describe('Maximum characters to return in this page.');

const LOCAL_READ = { readOnlyHint: true, openWorldHint: false } as const;

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
        'START HERE. Returns the Markdown context pack for a Bitbucket PR: overview, change summary, description, commits and a Read Strategy naming the files to open next. Syncs from Bitbucket automatically when the PR is not cached or has new commits.',
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
    ({ pr_url, ...filters }) => run('search_pr_files', () => json(PRContextService.searchPRFiles(pr_url, filters)))
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
      run('get_pr_file_context', () => withHint(PRContextService.getFileContext(pr_url, file_id, offset, max_chars)))
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
      run('get_pr_file_changes', () => json(PRContextService.getFileChange(pr_url, file_id, include_patch, offset, max_chars)))
  );

  server.registerTool(
    'get_pr_sync_status',
    {
      title: 'PR sync status',
      description: 'Local-only check: whether a PR is cached, its revision, sync time, source/target commits and stats. Does not contact Bitbucket.',
      inputSchema: { pr_url: prUrl },
      annotations: LOCAL_READ
    },
    ({ pr_url }) => run('get_pr_sync_status', () => json(PRContextService.getSyncStatus(pr_url)))
  );

  return server;
}
