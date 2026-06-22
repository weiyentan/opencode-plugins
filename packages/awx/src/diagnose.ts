/**
 * AWX Plugin Diagnostic Tool
 *
 * Introspects the plugin's internal state at runtime to identify
 * why getAwxClient() returns undefined. This is a debugging aid,
 * NOT a production tool.
 */
import { tool } from "@opencode-ai/plugin";
import type { PluginInput } from "@opencode-ai/plugin";

export interface DiagnosticContext {
  input: PluginInput;
  baseUrlFromOptions: string | undefined;
}

export function createDiagnosticTool(ctx: DiagnosticContext) {
  return tool({
    description: [
      "AWX Plugin Diagnostic Tool.",
      "Reports why AWX tools may not be available.",
      "Checks baseUrl configuration, client.getSecret availability,",
      "and all client methods. Run this first if AWX tools",
      "return 'AWX client not available'.",
    ].join(" "),
    args: {},
    async execute() {
      const { input, baseUrlFromOptions } = ctx;
      const clientObj = input.client as Record<string, unknown>;
      const clientKeys = Object.keys(clientObj).sort();

      const report: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
      };

      // 1. Check baseUrl
      if (baseUrlFromOptions) {
        report["✅ options.baseUrl"] = `"${baseUrlFromOptions}" (configured)`;
      } else {
        report["❌ options.baseUrl"] = "undefined — not passed from server";
      }

      // 2. Check environment variables
      report["process.env.AAP_BASE_URL"] = process.env.AAP_BASE_URL ?? "(not set)";
      report["process.env.AWX_BASE_URL"] = process.env.AWX_BASE_URL ?? "(not set)";
      report["process.env.AWX_TOKEN"] = process.env.AWX_TOKEN ? "(set)" : "(not set)";

      // 3. Check client properties
      report["client type"] = typeof clientObj;
      report["client keys (all)"] = clientKeys;

      // 4. Check getSecret specifically
      const getSecret = clientObj.getSecret;
      if (typeof getSecret === "function") {
        report["✅ client.getSecret"] = "exists as a function";
        try {
          const result = await getSecret("awx");
          report["getSecret('awx') result"] = result !== undefined && result !== null ? `"${String(result).substring(0, 10)}..." (found)` : "undefined or null (no token)";
        } catch (err) {
          report["getSecret('awx') error"] = String(err);
        }
      } else {
        report["❌ client.getSecret"] = `does not exist (typeof: ${typeof getSecret})`;
      }

      // 5. Check auth-related client properties
      report["client.auth exists"] = "auth" in clientObj ? `yes (typeof: ${typeof clientObj.auth})` : "no";
      report["client.provider exists"] = "provider" in clientObj ? `yes (typeof: ${typeof clientObj.provider})` : "no";
      report["client.config exists"] = "config" in clientObj ? `yes (typeof: ${typeof clientObj.config})` : "no";

      // 6. Search for any methods containing 'secret', 'credential', 'token', 'auth'
      const secretLikeMethods = clientKeys.filter(
        k => /secret|credential|token|auth/i.test(k)
      );
      if (secretLikeMethods.length > 0) {
        report["methods matching *secret*/ *credential*/ *token*/ *auth*"] = secretLikeMethods;
      } else {
        report["methods matching *secret*/ *credential*/ *token*/ *auth*"] = "none found";
      }

      // 7. Check if config has a method to list providers or auth
      const configObj = clientObj.config;
      if (configObj && typeof configObj === "object") {
        const configKeys = Object.keys(configObj as object).sort();
        report["client.config keys"] = configKeys;
      }

      const authObj = clientObj.auth;
      if (authObj && typeof authObj === "object") {
        const authKeys = Object.keys(authObj as object).sort();
        report["client.auth keys"] = authKeys;
      }

      return {
        output: JSON.stringify({ message: "AWX Plugin Diagnostic Report", report }, null, 2),
      };
    },
  });
}
