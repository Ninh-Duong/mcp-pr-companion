# S5: Config, operations and test infrastructure (Wave 1)

**Goal:**
- Close the configuration gaps in invariant 9.
- Stop log folders from growing forever.
- Make the test runner report every failure.
- Cover the untested auth and generation code.

**Findings:** INV-9a, INV-9b, INV-9c, TEST-1, TEST-2, TEST-3, TEST-4 (`freshness.test.ts`), TEST-6, TOOL-1, OPS-1, SEC-5.

**Owned files:**
- `.env.example`
- `README.md`: the config table only.
- `package.json`: `scripts` only.
- `bin/cli.js`
- `src/config/config.manager.ts`, `src/config/config.schema.ts`
- `src/utils/logger.ts`
- `src/core/logging/file.logger.ts`, `src/core/logging/run-summary.ts`
- `tests/run.mjs`
- `tests/benchmark.test.ts`, `tests/golden.test.ts`
- `tests/freshness.test.ts`: the `Date.now` restore only.
- `tests/stdio.test.ts`: the line-2 comment only.
- new files: `tests/auth.test.ts`, `tests/generation.test.ts`, `tests/logging.test.ts`

**Read-only references:**
- `src/core/auth/capability.probe.ts`, `auth.service.ts`, `account.policy.ts` (or wherever `validateEmail` lives)
- `src/core/generation/generation.manager.ts`, `generation.job.ts`
- `tests/launcher.test.ts`, `tests/logger.test.ts`

**Branch:** `opt/S5-config-ops-tests`

## Tests to write first

1. **INV-9b** (`tests/logger.test.ts` is not owned, so use the new `tests/logging.test.ts`):
   - With `DEBUG=true` in `process.env` **before** the config loads, `Logger.debug('x')` writes to `Logs/mcp-server.log`.
   - With it unset, nothing is written.
   - The point is that the logger now reads `ConfigManager`, so behaviour must stay the same.
2. **OPS-1** (`tests/logging.test.ts`):
   - Create `Logs/2000-01-01/`, `Logs/<today-20d>/`, `Logs/<today>/` and `Logs/not-a-date/`.
   - Construct `new FileLogger('generate')` with `LOG_RETENTION_DAYS=14`.
   - The two old dated folders are removed; today's folder and `not-a-date` remain.
3. **TEST-6** (`tests/auth.test.ts`): with a fake fetch, cover:
   - `/2.0/user` returns 200 with an email in `ALLOWED_EMAILS`: login/probe succeeds.
   - 401: the error names the credentials, and contains no token.
   - 403 missing `read:user`: the error names the scope.
   - 200 but the email is not allowed: the error says `ALLOWED_EMAILS`, and contains no email.
   - Read `capability.probe.ts` first and cover the probe's public method, with one scope missing per case.
4. **TEST-6** (`tests/generation.test.ts`): `GenerationManager` with 2 jobs, using a fake fetch that serves one PR and returns 500 for the other. The batch finishes, one result succeeds and one fails, and the error is redacted.
5. **TEST-1:** check by hand. Temporarily add a failing test file, and confirm that the runner runs every file, lists the failing ones, and exits 1. Then delete the file.

## Logic

### INV-9a/9c: `.env.example` and README config table

Add to `.env.example` (comments in English):
```
# Seconds a successful freshness check is trusted before get_pr_context_pack re-checks Bitbucket (0 = always check).
FRESHNESS_TTL_SECONDS=120
# Days to keep Logs/<date>/ run logs (CLI). 0 = keep forever.
LOG_RETENTION_DAYS=14
# true = write debug lines to Logs/mcp-server.log.
DEBUG=false
```

- **README:** one row per `PRIVACY_MODE`, `PRIVACY_REMOVE_AUTHOR` and `PRIVACY_FILE_PATH_MODE`. Say that `PRIVACY_MODE` is recorded in the redaction report only.
- Add rows for `LOG_RETENTION_DAYS` and `DEBUG`.

### INV-9b: logger via config

- `config.schema.ts`: add `debug: z.boolean()` (from `DEBUG === 'true'`) and `log_retention_days: z.number().int().min(0)` (default 14). Copy the coercion pattern used for `FRESHNESS_TTL_SECONDS`.
- `config.manager.ts`: map `DEBUG` and `LOG_RETENTION_DAYS` in the same place as the other variables.
- `logger.ts:51`: replace `process.env.DEBUG === 'true'` with a safe call:
  ```ts
  private static debugEnabled(): boolean { try { return ConfigManager.loadBase().debug; } catch { return false; } }
  ```
- **Import cycle:** if `config.manager.ts` imports `Logger`, a top-level import would create a cycle. Use `await import()` or move the read into a function. A static import is fine if `ConfigManager` only *calls* `Logger` inside functions. Check with `npx tsc` and the stdio test.
- `loadBase()` should be cheap. If it re-parses env on every call, cache the debug flag after the first read: `// ponytail: debug flag read once per process`.

### OPS-1: retention (`file.logger.ts`)

In the constructor, after `mkdirSync(this.logDir)`:
```ts
FileLogger.pruneOldDays(path.dirname(this.logDir), retentionDays);

private static pruneOldDays(logsRoot: string, days: number): void {
  if (days <= 0) return;
  const cutoff = Date.now() - days * 86_400_000;
  try {
    for (const name of fs.readdirSync(logsRoot)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue;
      const day = Date.parse(`${name}T00:00:00Z`);
      if (Number.isFinite(day) && day < cutoff) fs.rmSync(path.join(logsRoot, name), { recursive: true, force: true });
    }
  } catch { /* never fail a run over log cleanup */ }
}
```

- Read `days` from `ConfigManager.loadBase().log_retention_days` inside `try`, defaulting to 14.
- **Never** touch `mcp-server.log*`. It sits at the `Logs/` root and does not match the date regex.
- `run-summary.ts` writes `Logs/latest-summary.json`, a single file that is overwritten. No change needed; confirm and note it.

### TEST-1: runner (`tests/run.mjs`)

```js
const failed = [];
for (const file of files) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-pr-test-'));
  const { status } = spawnSync(process.execPath, [tsxCli, path.join(testsDir, file)], { cwd, stdio: 'inherit' });
  fs.rmSync(cwd, { recursive: true, force: true });
  if (status !== 0) { failed.push(file); console.error(`\n✗ ${file} failed`); }
}
if (failed.length) { console.error(`\n✗ ${failed.length} of ${files.length} test files failed: ${failed.join(', ')}`); process.exit(1); }
console.log(`\n✓ ${files.length} test files passed`);
```

- Keep the exact success line: AGENTS.md §6 and CI rely on it.
- Optional: a `--bail` flag that restores fail-fast.

### TEST-2: `benchmark.test.ts`, `golden.test.ts`

- Replace the hand-made pass/fail counters and emoji output with `assert.equal`/`assert.ok` from `node:assert/strict`.
- Keep the same scenarios and thresholds: manifest < 2.5 KB, and the 9 golden cases.
- A failure must throw, giving a non-zero exit.

### TEST-3

`tests/stdio.test.ts:2`: change "9 tools" to "10 tools". Better: remove the number, since the assertion is the source of truth.

### TEST-4 (`tests/freshness.test.ts:71-111`)

Wrap each `Date.now = …` block in `try { … } finally { Date.now = realNow; }`.

### TOOL-1: `package.json`

```json
"typecheck": "tsc --noEmit -p tsconfig.test.json"
```

Check that `tsconfig.test.json` exists; CI uses it. If not, use `tsc --noEmit`.

### SEC-5: `npm ci --ignore-scripts` (`bin/cli.js:168`)

1. Check whether any dependency needs an install script. Run `npm ci --ignore-scripts` in a temp copy, then `npm run build` and `npm test`. Also look for `"install"`/`"postinstall"` in `node_modules/*/package.json`, for example with `npm query ":attr(scripts, [postinstall])"`, or by checking `package-lock.json` for `"hasInstallScript": true`.
2. If nothing needs one, change the line to `npm(['ci', '--no-audit', '--no-fund', '--ignore-scripts'])`. The project's own `prepare` script does not exist (the `prepare-app` script is unrelated), so nothing is lost.
3. If something needs one (for example `esbuild` via `tsx`), keep the flag off and write the reason in the Handoff notes. Note that `esbuild`'s postinstall only verifies a binary; the binary ships as an optional dependency and works without the script. Verify that `tsx` still runs.
4. `tests/launcher.test.ts` must pass.

## Docs

- `.env.example` and the README config table, as above.
- AGENTS.md §6: if the runner's output wording changed, keep `✓ N test files passed` unchanged.

## Definition of done

- All new tests pass, and `npm test` lists all files.
- `npm run typecheck` is clean.
- `node bin/cli.js check` is all ✓.

**Commit:** `chore: env/README config gaps, log retention, full-run test runner, auth/generation tests`

## Status / Handoff notes
_(filled by the agent)_
