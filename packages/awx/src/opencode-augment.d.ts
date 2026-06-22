/**
 * Type augmentations for the OpenCode plugin SDK.
 *
 * Token capture is handled via the AuthHook.loader mechanism in auth.ts.
 * The `loader` callback captures the stored PAT at plugin load time,
 * making it available to tools via `getAwxToken()`.
 */
