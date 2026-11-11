# S1: Privacy redaction gaps (Wave 1)

**Goal:** text that leaves the process must not carry common secret formats. The fix must not redact ordinary code such as variable references.

**Findings:** SEC-1, SEC-6, and TEST-4 (the `privacy.test.ts` part).

**Owned files:**
- `src/core/privacy/secret.scanner.ts`
- `src/core/analyzer/sensitive.file.policy.ts`
- `src/core/bitbucket/pagination.ts`
- `tests/security.test.ts`
- `tests/privacy.test.ts`

**Read-only references:**
- `src/core/storage/data.store.ts`: where `scanAndRedact` runs on patches, titles and symbols.
- `src/core/privacy/redaction.report.ts`
- `docs/STANDARDS.md`

**Branch:** `opt/S1-privacy-redaction`

## Tests to write first (they must fail before the fix)

Add these to `tests/security.test.ts`, using `node:assert/strict`.

**Must be redacted:** `SecretScanner.scanAndRedact(line)` must not contain the value.

| Input line | Value that must disappear |
|---|---|
| `+DB_PASSWORD=hunter2hunter2` | `hunter2hunter2` |
| `+      POSTGRES_PASSWORD: Sup3rS3cret!` | `Sup3rS3cret!` |
| `+JWT_SECRET=abcdefghijklmnopqrstuvwxyz` | the value |
| `+  token: abcdefghijklmnop1234` | the value |
| `+export STRIPE_API_KEY="sk_test_abcdefghijkl1234"` | the value |
| `+webhook: https://hooks.slack.com/services/T000/B000/XXXXXXXXXXXXXXXX` | the path after `/services/` |
| `+spring.datasource.password=MyPa55word` (a `.properties` line) | `MyPa55word` |

**Must stay unchanged:** the output must equal the input.

| Input line | Why it must survive |
|---|---|
| `+  password: ${DB_PASSWORD}` | variable reference |
| `+const token = getToken();` | no assignment of a literal |
| `+password_hash: string;` | a type declaration, not a value |
| `+if (token === undefined) return;` | comparison, not assignment |
| `+SECRET_NAME=prod/db` | a short value of 7 characters does count as a secret; that is acceptable, so assert it **is** redacted and document the trade-off in the test |

**Pagination:** add a test that `PaginationHelper.fetchAllPages` with a fake `fetch` returning `401` and the body `{"error":"Bearer ATATT3xFfGF0abcdefghijklmnop"}` produces warnings without `ATATT3`.

## Logic

### SEC-1: `secret.scanner.ts`

1. **Fix `password_assignment` (line 86).** Change the start of the regex so that a name joined with `_` or `-` still matches:
   ```ts
   regex: /(?<![A-Za-z0-9])(?:[A-Za-z0-9]+[_.-])*(?:password|passwd|pwd|pass)\s*[:=]\s*(?!\$\{|\$\(|\{\{|process\.env|<)(?:"[^"\n]{4,}"|'[^'\n]{4,}'|[^"'\s;\n,]{4,})/gi
   ```
   - `(?:[A-Za-z0-9]+[_.-])*` covers `DB_`, `POSTGRES_` and `spring.datasource.`.
   - The negative lookahead skips `${…}`, `$(…)`, `{{…}}`, `process.env` and `<placeholder>`.
   - Watch `password_hash: string;`. The value `string` is 6 characters, so the new regex would redact it. That is acceptable only if the test above is adjusted. Prefer adding `(?!string\b|number\b|boolean\b)` to the lookahead, so TypeScript type annotations are kept.
2. **Add `generic_secret_assignment`.** Place it after `password_assignment` and before `credential_url`:
   ```ts
   {
     category: 'generic_secret',
     regex: /(?<![A-Za-z0-9])[A-Za-z0-9_.-]*(?:secret|token|api[_-]?key|private[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*\s*[:=]\s*(?!\$\{|\$\(|\{\{|process\.env|<|\[REDACTED)(?:"[^"\n]{6,}"|'[^'\n]{6,}'|[^\s"',;)]{6,})/gi,
     replacement: '[REDACTED:SECRET]'
   }
   ```
   - The `(?!\[REDACTED)` stops it re-matching output from earlier rules.
   - `const token = getToken()` must survive. `=` is followed by ` getToken()`, which has no quote and is 10 or more characters, so it **would** match. Add `(?![A-Za-z_$][\w$]*\s*\()` to the lookahead to skip function calls. Also skip bare identifiers followed by `;` or `)`, which are code: add `(?![A-Za-z_$][\w$.]*\s*[;),]?\s*$)`, used with the `m` flag. If this gets too clever, simplify. The tests are the contract.
3. **Add `slack_webhook`:**
   ```ts
   { category: 'slack_webhook', regex: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g, replacement: '[REDACTED:SLACK_WEBHOOK]' }
   ```
4. Keep the existing order and categories. `RedactionTracker` counts per category, so new categories are additive.

### SEC-1b: `sensitive.file.policy.ts`

Do **not** drop whole files: reviewers need `docker-compose.yml` and k8s manifests. Change nothing here unless the policy already supports tagging. The regex fix above is what protects these files. Record that decision in the Handoff notes.

### SEC-6: `pagination.ts`

- Line 39: `warnings.push(\`Pagination stopped at page ${pageCount}: HTTP ${res.status} (${SecretScanner.scanAndRedact(errText.substring(0, 200)).substring(0, 100)})\`)`. Redact **before** truncating, so a token cut in half is not missed.
- Line 55: wrap `err.message || String(err)` the same way.
- Import `SecretScanner` from `../privacy/secret.scanner.js`.

### TEST-4: `tests/privacy.test.ts:52-55`

Wrap the `Date.now` override in `try { … } finally { Date.now = realNow; }`.

## Docs

- `docs/STANDARDS.md` and `docs/ARCHITECTURE.md` (privacy section): add one line listing the new categories `generic_secret` and `slack_webhook`. Since S1 does not own these files, put the sentence in the Handoff notes for S9.

## Definition of done

- The new tests pass, and all existing `security`/`privacy`/`golden` tests pass without changing their expectations.
- `npx tsc --noEmit` is clean and `npm test` passes.

**Commit:** `fix(privacy): redact prefixed password/secret assignments and pagination error bodies`

## Status / Handoff notes
_(filled by the agent)_
