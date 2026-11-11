# S2: Crypto scope check and AccessGate dedup (Wave 1)

**Goal:**
- A decrypted file must belong to the scope the caller expects.
- Concurrent unlocks of one repository must share a single Bitbucket request.
- The documented threat model must be honest.

**Findings:** SEC-3 (API part), SEC-4, PERF-7.

**Owned files:**
- `src/core/storage/secure-file.ts`
- `src/core/auth/access-gate.ts`
- `docs/ENCRYPTION.md`
- `tests/secure-file.test.ts`
- new file `tests/access-gate.test.ts`

**Read-only references:**
- `src/core/output/output.reader.ts`: the caller that S6 will update.
- `src/core/bitbucket/bitbucket.collector.ts` (`getRepositoryUuid`)
- AGENTS.md invariant 11

**Branch:** `opt/S2-crypto-scope`

**Frozen:** `MAGIC = 'PRC1\n'`, `INFO`, the header shape `{v:1, workspace, repo, pr, salt}`, and the byte layout. Do not change them.

## Tests to write first

In `tests/secure-file.test.ts`:
1. **Matching scope works.** Write a file with scope `{acme, demo, 1}` and call `AccessGate.setMaterial('acme','demo','{uuid}')`. Then `readSecure(file, {workspace:'acme', repoSlug:'demo', prId:1})` returns the text, and the comparison ignores case (`ACME`/`Demo`).
2. **Wrong PR fails.** `readSecure(file, {acme, demo, 2})` throws `/Cannot decrypt/`.
3. **Wrong repository fails.** Unlock `other` too. `readSecure(file, {acme, other, 1})` throws `/Cannot decrypt/`. This is the cross-repository case from SEC-3.
4. **No scope keeps the old behaviour.** `readSecure(file)` still works, for backward compatibility.

In the new `tests/access-gate.test.ts`:
5. **Concurrent unlocks share one request.** Replace `globalThis.fetch` with a counter that returns a `{uuid}` for `/2.0/repositories/acme/demo` and a user for `/2.0/user`, matching whatever `BitbucketCollector` requires (copy the env setup from `tests/server.test.ts`). Run `await Promise.all([unlock, unlock, unlock])` for `acme/demo`; the repository endpoint must be requested exactly once.
6. **A failed unlock is not cached.** The first call gets a 403 and rejects. The second call makes a new request.

## Logic

### SEC-3: `secure-file.ts`

```ts
const sameScope = (header: SecureHeader, expected: SecureScope) =>
  header.workspace.toLowerCase() === expected.workspace.toLowerCase() &&
  header.repo.toLowerCase() === expected.repoSlug.toLowerCase() &&
  header.pr === expected.prId;

export function decryptBuffer(buffer: Buffer, expected?: SecureScope): string {
  const { headLine, header, body } = split(buffer);
  if (expected && !sameScope(header, expected)) throw new Error(DECRYPT_FAILED);
  // … unchanged
}

export function readSecure(file: string, expected?: SecureScope): string {
  return decryptBuffer(fs.readFileSync(file), expected);
}
```

- Use the same error text (`DECRYPT_FAILED`), so a mismatch looks exactly like tampering.
- Leave `copySecureTree`, `secureTreesEqual` and `verifySecureTree` unchanged. They are migration helpers for one PR scope; adding a scope to them is optional.
- Add above `decryptBuffer`:
  `// ponytail: the scope check binds a file to its PR, not to its path inside the PR; a header v:2 with the relative path in the AAD would close that, see docs/ENCRYPTION.md.`

### PERF-7: `access-gate.ts`

```ts
private static pending = new Map<string, Promise<void>>();

static unlock(workspace: string, repoSlug: string): Promise<void> {
  const key = this.key(workspace, repoSlug);
  const cached = this.unlocked.get(key);
  if (cached && cached.until > Date.now()) return Promise.resolve();
  const running = this.pending.get(key);
  if (running) return running;
  const task = (async () => {
    let collector: BitbucketCollector;
    try { collector = new BitbucketCollector(); }
    catch (err) { throw new Error(`No access: ${err instanceof Error ? err.message : String(err)}`); }
    const uuid = await collector.getRepositoryUuid(workspace, repoSlug);
    this.setMaterial(workspace, repoSlug, uuid);
  })().finally(() => this.pending.delete(key));
  this.pending.set(key, task);
  return task;
}
```

- Keep `async`-compatible behaviour: callers `await` it.
- `lockAll()` must also clear `pending`.

### SEC-4: `docs/ENCRYPTION.md`

Add a short "What this protects against" paragraph in §1 and extend §6 (limits):
- The key is derived from the repository UUID. Anyone who can call the Bitbucket API for that repository can derive it: the token in `.env`, or anonymous callers for a **public** repository. The UUID also appears in PR and webhook payloads.
- So the encryption stops casual reading of `ai-context/` by tools and agents that do not hold Bitbucket access. It does not protect against someone who can read `.env`.
- A file is now also checked against the PR scope the caller expects. Path-level binding (a header `v:2` with the path in the AAD) and mixing a local secret into HKDF are upgrade options, and are not implemented.

## Docs

- `docs/ENCRYPTION.md`, as above.
- AGENTS.md invariant 11 does not change.

## Definition of done

- The new tests pass and the existing `secure-file`/`server` tests pass.
- `npx tsc --noEmit` is clean and `npm test` passes.

**Commit:** `feat(security): verify decrypted file scope and dedupe concurrent access checks`

## Status / Handoff notes

- **For S6:** call `readSecure(file, scope)` from every `OutputReader` read.
- _(filled by the agent)_
