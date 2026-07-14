import type { PluginInput, Hooks, Plugin } from "@opencode-ai/plugin";
import { getDb, close } from "./client.js";
import { createTablesTool } from "./tools/tables.js";
import { createSchemaTool } from "./tools/schema.js";
import { createQueryTool } from "./tools/query.js";

async function server(_input: PluginInput): Promise<Hooks> {
  return {
    dispose: async () => {
      close();
    },
    tool: {
      ...createTablesTool(getDb),
      ...createSchemaTool(getDb),
      ...createQueryTool(getDb),
    },
  };
}

export const SqlitePlugin: Plugin = server;
export default SqlitePlugin;
