# ADR 0009: Structured Output with Lossless Raw Fallback

## Status

Accepted

## Context

The AWX plugin defines strict Zod contracts for tool output. Every field that the agent sees must pass through the contract, and fields not in the contract are dropped. This creates a **lossy** experience — the agent cannot access data that the API returns if it wasn't anticipated in the contract.

For the GitHub and GitLab plugins, we want tool output that is:
- **Not noisy** — the agent's default view should be a concise, curated summary without ballooning the context window
- **Not lossy** — the full API response should be accessible when the agent needs deeper inspection

We also considered two alternatives:

1. **Raw passthrough** — return `metadata: { raw: fullApiResponse }` with no curation. Simple but noisy. A `github_issue_list` with 30 issues could dump 25-40 KB of JSON into context.

2. **Strict contracts** — like AWX. Clean but lossy. Fields not in the contract are invisible to the agent.

## Decision

Use a **hybrid shape** for every tool:

```typescript
return {
  output: string,           // human-readable formatted text
  metadata: {
    count: number,          // result count
    items: Array<{...}>,    // curated fields — what the agent normally needs
    _raw: unknown,          // FULL API response, accessible on demand
  }
}
```

The `items` array contains the curated fields the agent typically needs (id, title, state, url, etc.). The `_raw` field contains the complete API response and is always present but will only be read by the agent when it needs deeper data.

## Consequences

- **Positive**: Agent's default view is concise. Context doesn't balloon from verbose API responses.
- **Positive**: Lossless — any field the API returns is reachable via `_raw`.
- **Positive**: No Zod contract maintenance for every tool shape.
- **Negative**: Agents must learn to reach into `_raw` for non-obvious fields.
- **Negative**: Slightly larger metadata payload than strict contracts.
