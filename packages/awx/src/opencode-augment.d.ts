/**
 * Augment the OpencodeClient interface to expose the runtime-injected
 * getSecret method provided by the OpenCode server.
 */
declare module '@opencode-ai/sdk' {
  interface OpencodeClient {
    getSecret?(key: string): Promise<string | undefined>;
  }
}
