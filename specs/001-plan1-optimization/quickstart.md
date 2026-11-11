# Quickstart Validation Guide: Plan 1 Optimization

## Prerequisites
- Node.js `>= 20.12`
- Dependencies installed (`node_modules/` matching `package-lock.json`)
- No network access required for unit/integration suites (all HTTP calls use mocked `globalThis.fetch`)

## Validation Scenarios

### 1. Build, Typecheck & Full Test Suite
```powershell
npx tsc --noEmit
npm run typecheck
npm run build
npm test
```
**Expected**: Zero compiler errors; `npm test` executes every `tests/*.test.ts` file (even if one fails during TDD red phases) and concludes with `✓ <N> test files passed`.

### 2. CLI Self-Check (with `.env` or Hub config)
```powershell
node bin/cli.js check
```
**Expected**: `✓ Node.js`, `✓ Dependencies`, `✓ Build`, `✓ Config`.

### 3. Invariant Verification Spot Checks
```powershell
# Invariant 1: No stdout leakage outside src/cmd/
Select-String -Path (Get-ChildItem -Recurse src\mcp,src\core,src\utils -Include *.ts) -Pattern "console\.log|process\.stdout"
# Invariant 2: Sole fetch() site and GET-only Bitbucket calls
Select-String -Path (Get-ChildItem -Recurse src -Include *.ts) -Pattern "\bfetch\("
Select-String -Path (Get-ChildItem -Recurse src\core\bitbucket -Include *.ts) -Pattern "method:"
# Invariant 9: Centralized process.env access
Select-String -Path (Get-ChildItem -Recurse src -Include *.ts) -Pattern "process\.env"
# Invariant 11: Encrypted ai-context I/O only through secure-file.ts / atomic.writer.ts
Select-String -Path (Get-ChildItem -Recurse src -Include *.ts) -Pattern "readFileSync|writeFileSync"
```
**Expected**: Only `src/core/bitbucket/http.ts` calls `fetch()`, only `src/config/config.manager.ts` reads `process.env`, zero `console.log`/`process.stdout` in server/core/utils, and zero raw file reads/writes under `ai-context/`.

### 4. SpecKit Cross-Artifact Verification
```powershell
.specify/scripts/powershell/check-prerequisites.ps1 -Json -RequireTasks -IncludeTasks
```
**Expected**: Clean JSON output resolving `FEATURE_DIR` and `AVAILABLE_DOCS`.
