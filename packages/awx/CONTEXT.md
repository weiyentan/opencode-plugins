# AWX Plugin Auth Flow — Diagnosis Context

## 1. The Bug

- Plugin loads successfully and all 7 tools register without errors.
- But `getAwxClient()` always returns `undefined` at runtime.
- Every tool call silently fails with "AWX client not available."
- The bug manifests exclusively in the real OpenCode runtime (`OpenCode.exe`); no test caught it because every test mocked the missing method.
- The error is thrown at tool execution time, not at plugin load time — so the plugin appears healthy until a tool is invoked.

## 2. Root Cause: `getSecret` Is a Phantom

- `@opencode-ai/sdk@1.17.8`'s `OpencodeClient` class has **no `getSecret` method at runtime**. No version found on this machine (v1.14.29, v1.17.8) has it either.
- The file `src/opencode-augment.d.ts` declares a TypeScript module augmentation that adds `getSecret` to the `OpencodeClient` interface. This satisfies the TypeScript compiler only — it has zero effect on runtime behavior.
- The real OpenCode server (`OpenCode.exe`) is a prebuilt binary distributed via Chocolatey. Its plugin-loading code is not accessible, so we cannot confirm whether it ever injects `getSecret`, `getSecretAsync`, or uses a completely different mechanism.
- The code uses optional chaining: `input.client.getSecret?.("awx")`. Because the method simply doesn't exist, the expression evaluates to `undefined` and `getAwxClient()` returns `undefined` without ever throwing.
- The file `opencode-plugin-dev/plugins/index.js` (the built artifact the server loads) contains the same `getSecret?.("awx")` call at line 110 — the bug is shipped in the published artifact.

## 3. What `OpencodeClient` Actually Has

- `client.app` — app sub-client (has `log()` method for structured logging)
- `client.config` — config sub-client
- `client.session` — session sub-client
- `client.auth` — auth sub-client with methods: `set`, `remove`, `start`, `callback`, `authenticate` (all SET-oriented; there is no GET/retrieve method)
- `client.file` — file sub-client
- `client.tool` — tool sub-client
- Other namespaced sub-clients
- **No `getSecret`, `getCredential`, `getToken`, `secrets`, `credentials`, `setSecret`, or any generic GET method exists anywhere on the type or in the SDK source.**

## 4. Test Blind Spot

- All 247 existing tests mocked `getSecret` as `vi.fn().mockResolvedValue("mock-token-xxx")` on the `input.client` object. This created **false confidence** — tests pass with flying colors, but the real runtime always fails.
- Specific test files that mock `getSecret`:
  - `tests/index.test.ts` (22 tests)
  - `tests/lifecycle.test.ts` (1 test)
  - `tests/auth.test.ts` (18 tests)
  - `tests/client.test.ts` (26 tests)
  - `tests/get-job-events.test.ts`, `wait-job.test.ts`, `sync-project.test.ts`, `job-status.test.ts`
  - `tests/plugin-init-timeout.test.ts`
  - `tests/integration/read-only.test.ts`, `integration/job-lifecycle.test.ts`
- A **feedback-loop test** (`tests/getclient-realistic.test.ts`) was added that simulates the real server behavior — it deliberately omits `getSecret` from the mock client. This test is designed to **PASS** right now (confirming the bug exists). When the auth flow is fixed, this test must be updated.
- The TypeScript module augmentation in `opencode-augment.d.ts` contributed to the blind spot by making the test mocks type-safe, further masking the discrepancy.

## 5. Auth Hook Setup (Exists but Not Connected)

- The plugin registers an auth hook in `src/auth.ts`:
  ```ts
  auth: {
    type: "api",
    provider: "awx",
    authorize: async (inputs) => {
      // inputs.token would be the PAT — but nothing populates inputs
      return { type: "success", key: inputs.token };
    },
  }
  ```
- The `authorize()` function is meant to be called by the OpenCode server when the user enters credentials via a prompt. The `provider: "awx"` value should link the auth hook to the `getSecret("awx")` call — but this bridge **does not work**.
- The returned `key` (the PAT token) is never stored where tools can retrieve it. There is no wiring between the auth hook's `authorize()` output and the `getSecret()` retrieval path.
- The auth hook validates the token via `GET /api/v2/me/` (in `validateToken()`) — but the token itself is effectively lost after validation because there is no way to read it back.

## 6. How Other Plugins Handle Auth

- **wakatime**: Bypasses OpenCode auth entirely. Reads the API key from a filesystem config file (`~/.wakatime.cfg`) using `fs.readFileSync`. This avoids any dependency on `getSecret` or the auth hook system.
- **firecrawl**: Not fully investigated, but the known pattern across working plugins is: **avoid depending on SDK auth injection for credential retrieval**. The SDK's auth system appears designed for SET operations only (storing tokens), with no corresponding GET/retrieve mechanism.

## 7. Hypotheses for Fixing (Resolved)

*The following hypotheses were under consideration during diagnosis. The fix decision has been made and implemented (see § Fix Decision below).*

| Hypothesis | Approach | Verdict |
|---|---|---|
| **H1: Setup tool pattern** | Add an `awx-setup` tool accepting `baseUrl` + `token` as args; store in a module-level variable | ✅ **Adopted** as Tier 1 (`customConfig` via `awx-configure` tool) |
| **H2: Server version fallback** | Check `typeof input.client.getSecret` and fall back to alternative (env var, file read) if undefined | ✅ **Adopted** as Tier 2 (`getSecret` fallback in chain) |
| **H3: `client.auth.set()` + retrieval path** | Use `auth.set` to store the token, then find some way to read it back | ❌ **Rejected** — SDK auth is SET-only; no GET/retrieve path exists |
| **H4: Env var fallback** | Read `AWX_TOKEN` from `process.env` as a secondary credential source | ✅ **Adopted** as Tier 3 (env var fallback) |

These options were evaluated and resolved by the 3-tier auth fallback chain (customConfig → getSecret → AWX_TOKEN) — see § Fix Decision below for the implemented solution.

## 8. Key Files

| File | Role |
|---|---|
| `src/index.ts` | Plugin entry point. Defines `getAwxClient()` which calls `input.client.getSecret?.("awx")` (lines 113, 134). All tools call `getAwxClient()`. |
| `src/opencode-augment.d.ts` | TypeScript phantom declaration that adds `getSecret` to the `OpencodeClient` interface — compile-time only, no runtime effect. |
| `src/auth.ts` | Auth hook factory — `createAwxAuthHook()` registers `type: "api"` auth with `provider: "awx"` and `authorize()`. |
| `src/client.ts` | HTTP middleware pipeline (circuit breaker, retry/backoff, timeout). Downstream consumer of the token. |
| `node_modules/@opencode-ai/sdk/` | SDK source. Confirms `OpencodeClient` has NO `getSecret` method in `@opencode-ai/sdk@1.17.8`. |
| `opencode-plugin-dev/node_modules/@opencode-ai/sdk/` | Older SDK copy (v1.14.29) at the plugin runtime site. Also lacks `getSecret`. |
| `opencode-plugin-dev/plugins/index.js` | Built artifact of the plugin — the file the OpenCode server actually loads. Contains the same `getSecret?.("awx")` call. |
| `tests/getclient-realistic.test.ts` | Feedback-loop test that proves the bug by omitting `getSecret` from the mock. Designed to PASS until the auth flow is fixed. |
| `tests/index.test.ts` | Main plugin test suite — all 22 tests mock `getSecret`, masking the bug. |
| `tests/integration/read-only.test.ts` | Integration tests — mocks `getSecret`, does not catch the bug. |
| `C:\Users\weiye\AppData\Local\OpenCode\OpenCode.exe` | Prebuilt OpenCode server binary (Chocolatey install). Source not accessible. |

### Fix Decision: 3-Tier Auth Fallback Chain

**Date:** 2026-06-23

**Problem:** `getAwxClient()` always returned `undefined` because `input.client.getSecret?.("awx")` is a phantom method — the TypeScript augmentation in `opencode-augment.d.ts` declares it, but `@opencode-ai/sdk@1.17.8`'s `OpencodeClient` class has no such method at runtime, and the OpenCode server (`OpenCode.exe`) does not inject it.

**Decision:** Replace the single `getSecret` dependency with a 3-tier fallback chain:

```
customConfig (module-level, via awx-configure tool)
    → getSecret (server-injected, if ever available)
        → process.env.AWX_TOKEN (env var fallback)
```

**What changed:**
| File | Change |
|------|--------|
| `src/index.ts` | Added `customConfig` module-level storage + `setCustomConfig()` |
| `src/index.ts` | Updated `getAwxClient()` with 3-tier fallback chain |
| `src/index.ts` | Added `awx-configure` tool (accepts `baseUrl` and/or `token`) |
| `tests/getclient-realistic.test.ts` | Added 7 test cases for the fallback chain and new tool |

**Test results:** 265 tests pass, 0 failures (was 254 before, proving no regressions).

**Rationale:**
- Tier 1 (`customConfig`): User can configure credentials interactively via the `awx-configure` tool without restarting OpenCode
- Tier 2 (`getSecret`): If the OpenCode server ever starts injecting this method, it works for free
- Tier 3 (`env var`): Quick bootstrap — set `$env:AWX_TOKEN` before launching OpenCode and it just works
- The `awx-configure` tool also accepts an optional `baseUrl` parameter, allowing override of `AWX_BASE_URL`

**Alternatives considered:**
- H4-only (env var): simpler, but requires server restart to change token — rejected as less usable
- auth.set path: dead end — `client.auth` has no GET/retrieve methods
- Pure getSecret: what broke in the first place — rejected as unreliable

**Status:** Implemented and deployed on branch `fix-awx-default-export-local-loading`.
