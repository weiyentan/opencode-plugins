let customConfig: { baseUrl?: string; token?: string } | undefined;

export function setCustomConfig(config: { baseUrl?: string; token?: string } | undefined): void {
  customConfig = config;
}

export function getCustomConfig(): { baseUrl?: string; token?: string } | undefined {
  return customConfig;
}
