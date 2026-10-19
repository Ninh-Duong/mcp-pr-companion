# Architecture

## 1. Topology

```mermaid
flowchart LR
    subgraph Clients
        A[AI client] -->|stdio| H[mcp-hub]
        A2[AI client, direct] -->|stdio| L
        U[Developer] -->|terminal| L
    end
    H -->|"stdio: node bin/cli.js server"| L[bin/cli.js launcher]
    L -->|spawn, cwd = project root| S[dist/mcp/server.js]
    L -->|spawn| C[dist/cmd/*.runner.js]
    S --> P[PRContextService]
    C --> G[GenerationManager]
    P --> COL[BitbucketCollector]
    G --> COL
    COL -->|GET only| BB[(Bitbucket Cloud API)]
    COL --> DS[DataStore.saveRevision]
    DS --> RW[RevisionWriter]
    RW --> FS[(ai-context/)]
    P -->|reads| FS
```

The MCP server and the CLI share one pipeline and one on-disk store. Neither keeps PR data in memory between calls.

## 2. Pipeline: Bitbucket → context pack

| Step | Code | What happens |
|---|---|---|
| 1. Collect | `BitbucketCollector.collect` | Metadata first (it fails hard if this fails), then commits, diffstat and raw diff in parallel. Partial failures become `coverage` entries and `warnings`, not exceptions. |
| 2. Project | `BitbucketAllowlistProjector` | Keeps only the allowlisted fields. The author is dropped when `PRIVACY_REMOVE_AUTHOR`; commit subjects are capped by `PRIVACY_MAX_COMMIT_SUBJECTS`. |
| 3. Sanitize | `PIISanitizer`, `SecretScanner`, `PathSanitizer` | Emails and account UUIDs in title, description and commits. Secrets in all text and every patch. Paths per `PRIVACY_FILE_PATH_MODE`, including diff header lines. |
| 4. Analyze | `DiffParser` → `ChangeClassifier` → `RiskAnalyzer` → `SymbolExtractor` | Per file: change kind, risk level/tags/evidence, touched symbols (regex heuristics, not an AST). |
| 5. Summarize | `DataStore.saveRevision` | Manifest (change and risk summary, ticket id from `TICKET_PREFIXES`), file index, per-file `change.json` and `patch.diff`, coverage. |
| 6. Read Strategy | `ContextModeClassifier` | Picks `skim` / `standard` / `inspect_priority_files` / `deep_review`, the files to read next and a token budget. |
| 7. Persist | `RevisionWriter.writeRevision` | See §4. |

## 3. On-disk layout (frozen: AGENTS.md invariant 7)

```text
ai-context/[<AI_CONTEXT_COMPANY>/]<workspace>/<repo>/pr_<id>/
├── current.json            ← active revision pointer (written last)
├── context.md              ← what get_pr_context_pack returns
├── files.md                ← table of every changed file (include_file_table)
├── actions.md              ← coverage per section
├── manifest.json           ← copy of the active manifest (backward compatibility)
├── files/file_NNNN.md      ← what get_pr_file_context returns
└── revisions/rev_<src7>_<dst7>/
    ├── manifest.json
    ├── files.index.jsonl   ← what search_pr_files filters
    ├── commits.jsonl
    ├── coverage.json
    └── files/file_NNNN/{change.json, patch.diff}   ← get_pr_file_changes
```

Other local state, all git-ignored: `Logs/mcp-server.log` (MCP and launcher log), `Logs/<date>/*.jsonl` (CLI run logs), `.mcp-pr-companion/prs/salt.key` (salt for the opaque repo ids in CLI logs).

`OutputReader.getPROutputDir` also finds older folders written without a company segment or under the default root.

## 4. Write path and atomicity

1. Write the revision into `revisions/.tmp-<rev>-<ts>/`.
2. `RevisionValidator.validateOrThrow`: zod schemas plus cross-checks such as index totals against the manifest. On failure the temp folder is deleted and the active revision is untouched.
3. Rename it into `revisions/<rev>/`.
4. Rebuild `files/` aside, then swap it in, so ids from an older, larger revision never linger.
5. Write `context.md`, `files.md`, `actions.md` and the top-level `manifest.json` with `AtomicWriter` (temp file, fsync, rename).
6. Write **`current.json` last**. It is the commit point.
7. Prune: keep the active revision and the 4 newest others (`RevisionWriter.KEEP_REVISIONS = 5`).

A crash before step 6 leaves the previous `current.json` in place. Steps 4–5 may already show the new pack while `current.json` still names the old revision. The next sync repairs that.

## 5. Freshness and concurrency (MCP)

```mermaid
sequenceDiagram
    participant Agent
    participant S as PRContextService
    participant BB as Bitbucket
    Agent->>S: get_pr_context_pack(pr_url)
    alt no local revision, or refresh=true
        S->>BB: full collect
    else local revision exists
        S->>BB: GET pullrequest (metadata only)
        alt source/target commit changed
            S->>BB: full collect
        else unreachable
            S-->>Agent: "Note: could not check…" + cached pack
        end
    end
    S-->>Agent: context.md
```

- `PRContextService.sync` keeps one in-flight promise per PR, so parallel calls (refresh or not) share a fetch.
- File tools never contact Bitbucket. They read the revision that `get_pr_context_pack` last made current.
- Missing credentials or an `ALLOWED_EMAILS` denial fail the call, even when cached data exists.

## 6. Process model

- `bin/cli.js` is the only supported entry. It keeps `node_modules` and `dist/` in sync with the lockfile and `src/` (via stamps), loads `.env` (real env vars win), checks the required keys, and spawns the entry with `cwd` = project root.
- Under mcp-hub the child's stderr is discarded. The launcher and `Logger` therefore also append to `Logs/mcp-server.log`.
- The first start on a fresh clone runs `npm ci` and `tsc`, which can take a minute. Run `node bin/cli.js prepare` once before connecting a client.
