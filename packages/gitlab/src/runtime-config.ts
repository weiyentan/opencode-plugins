// Runtime configuration helpers for the GitLab plugin.
// These are intentionally kept separate from the plugin entrypoint
// to avoid OpenCode's legacy plugin loader treating them as plugins.
// See docs/adr/0007-plugin-entry-point-export-hygiene.md

export interface CustomConfig {
  token?: string;
  baseUrl?: string;
}

let customConfig: CustomConfig | undefined;

export function setCustomConfig(config: CustomConfig | undefined): void {
  customConfig = config;
}

export function getCustomConfig(): CustomConfig | undefined {
  return customConfig;
}
