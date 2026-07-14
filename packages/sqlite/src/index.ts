import type { PluginInput, Hooks, Plugin } from "@opencode-ai/plugin";

async function server(_input: PluginInput): Promise<Hooks> {
  return {
    tool: {},
  };
}

export const SqlitePlugin: Plugin = server;
export default SqlitePlugin;
