# ADR 0001: Bearer Token Authentication for AWX Plugin

**Status:** Accepted  
**Date:** 2026-06-20  
**Council Session:** `awx-plugin-prd-20260620-135410`

## Context

The existing PowerShell-based AWX stack uses username/password authentication via the `AnsibleTower` module, which exchanges credentials for a session token internally. The proposed `@opencode-ai/plugin-awx` PRD specified bearer token authentication via OpenCode's `auth` hook (`type: "api-key"`), but the `awx-windows` skill explicitly documented that PAT (Personal Access Token) authentication returns 401 on the target AAP instance.

This created a foundational unknown: if bearer tokens don't work, the entire auth model, credential storage, init flow, and security checklist would need redesign around an OAuth2 login flow.

## Decision

**Use bearer token authentication** via the `Authorization: Bearer <token>` header, stored through OpenCode's plugin `auth` hook.

## Evidence

A spike (`curl -H "Authorization: Bearer <PAT>" https://aap.tanscloud-internal.com/api/v2/me/`) returned HTTP 200 with full user data, confirming that bearer token authentication is supported on the target AAP instance. The documented PAT auth failure in the `awx-windows` skill appears to be specific to how the PowerShell `AnsibleTower` module constructs the request, not a server-side restriction.

## Consequences

- The plugin auth module can proceed with the `type: "api-key"` auth hook as specified in the PRD.
- No OAuth2 login flow is needed for v1.
- The auth spike's secondary question — token TTL — remains open and should be checked (`/api/v2/tokens/` to find the token's expiry).
- If token TTL is short (hours rather than days), a token refresh mechanism may still be needed for long sessions.

## Alternatives Considered

1. **OAuth2 login flow** — Exchange username/password for a session token on plugin init. Rejected because bearer token auth works, making this extra complexity with no benefit.
2. **Basic Auth** — Send username/password with every request. Rejected on security grounds (credentials sent on every request, harder to revoke).
3. **Two-tier auth** (bearer primary + OAuth2 refresh fallback) — Reserve for v2 if token TTL proves problematic.
