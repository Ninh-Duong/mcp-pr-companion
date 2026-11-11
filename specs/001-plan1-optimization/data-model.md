# Data Model & Internal Interfaces: Plan 1 Optimization

All on-disk Schema v4 file names and required fields remain **frozen**. Additive optional fields and internal TypeScript interface contracts are listed below.

## 1. Cryptographic Scope (`src/core/storage/secure-file.ts`)

```ts
export interface SecureScope {
  workspace: string;
  repoSlug: string;
  prId: number;
}
```
- `decryptBuffer(buffer: Buffer, expected?: SecureScope): string`
- `readSecure(file: string, expected?: SecureScope): string`
- **Invariant**: `sameScope(header, expected)` matches `workspace` and `repo` case-insensitively and `pr` strictly (`===`). Mismatch throws `DECRYPT_FAILED` (`'Cannot decrypt: no access to this repository or the file was modified.'`).

## 2. Revision Write & Validation Contracts (`src/core/output/`)

```ts
export interface WriteRevisionInput {
  workspace: string;
  repoSlug: string;
  prId: number;
  sourceHash: string;
  destinationHash: string;
  manifestData: Omit<PRManifestV4, 'schema_version'>;
  fileEntries: FileIndexEntryV4[];
  fileChanges: Map<string, { change: FileChangeV4; diffContent: string }>;
  commitsJsonl: string[];
  coverage: PRCoverageV4;
  company?: string;
  root?: string;
  status?: PRStorageStatus;
  previousPrDirs?: string[];
}

export interface RevisionData {
  manifest: unknown;
  coverage: unknown;
  indexLines: string[];
  changes: Map<string, { change: unknown; patchExists: boolean }>;
  fileDirs: string[];
}
```
- **Validation rule**: `validateData(data)` executes pure schema + aggregate + relative `path.posix.normalize` traversal checks before staging writes begin; `validate(stagingDir)` decrypts disk files into `RevisionData` and calls `validateData(data)` for migration paths. No absolute path may appear in `errors` or `warnings`.

## 3. Configuration Additions (`src/config/config.schema.ts`)

```ts
debug: bool(false),                              // env.DEBUG === 'true'
log_retention_days: z.preprocess(unset, z.coerce.number().int().min(0).default(14)) // env.LOG_RETENTION_DAYS
```
- `LOG_RETENTION_DAYS=0` disables pruning; values `> 0` delete `Logs/YYYY-MM-DD/` folders older than `N` days on `FileLogger` construction while preserving `Logs/mcp-server.log*` and non-date directories.

## 4. Untrusted Content Envelope (`src/core/output/markdown.formatter.ts`)

```ts
export const untrusted = (source: string, text: string): string =>
  `<untrusted_pr_content source="${source}">\n${text.replace(/<\/?untrusted_pr_content/gi, m => m.replace('<', '&lt;'))}\n</untrusted_pr_content>`;
```
- `source` values: `'description'`, `'commits'`, `'diff'`, `'comments'`, `'build_status'`.
- Guarantees single balanced outer closing tag even if user text injects `</untrusted_pr_content>`.

## 5. Decomposed MCP Service Modules (`src/mcp/` — Wave 4)

| Module | Exports | Dependencies |
|---|---|---|
| `src/mcp/text.ts` | `errorText`, `cleanText`, `capText`, `sameCommit`, `statusCommitHash` | `privacy/`, `SecretScanner`, `PIISanitizer` |
| `src/mcp/freshness.ts` | `sync`, `ensureFresh` | `text.ts`, `core/` |
| `src/mcp/review-live.ts` | `reviewStatusSection`, `reviewThreadsSection`, `getComments` | `text.ts`, `markdown.formatter.ts`, `core/` |
| `src/mcp/my-prs.ts` | `listMyOpenPRs`, `syncMyOpenPRs`, `autoSync` | `text.ts`, `freshness.ts`, `core/` |
| `src/mcp/context.service.ts` | `PRContextService` static facade (`page`, `getContextPack`, `getFileContext`, `getFileChange`, `searchPRFiles`, `listSyncedPRs`, `getSyncStatus`, + forwarders) | `freshness.ts`, `review-live.ts`, `my-prs.ts`, `text.ts`, `core/` |
