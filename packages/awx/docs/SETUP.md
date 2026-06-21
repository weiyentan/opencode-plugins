# AWX Plugin Setup Guide

Setup instructions for `@weiyentan/opencode-plugin-awx` in OpenCode.

## Quick Start

### 1. Install the plugin

Add the plugin to your OpenCode config:

**File:** `~/.config/opencode/opencode.json`

```json
{
  "plugin": [
    ["@weiyentan/opencode-plugin-awx", { "baseUrl": "https://your-aap-instance.com" }]
  ]
}
```

Replace `https://your-aap-instance.com` with your actual AAP base URL (e.g., `https://aap.tanscloud-internal.com`).

### 2. Restart OpenCode

The plugin auto-downloads from npm on startup.

### 3. Store your PAT

OpenCode's `/connect` dialog may not display plugin-registered providers by default. Use the **"Other"** option to manually register the credential:

1. In OpenCode TUI, run: `/connect`
2. Scroll down and select **"Other"** (at the bottom of the list)
3. When prompted for a **provider ID**, type exactly: `awx`
4. When prompted for an **API key**, paste your **AWX Personal Access Token (PAT)**
5. Press Enter to save

Generate a PAT at: `https://your-aap-instance.com/api/v2/tokens/` or **AAP → Profile → Tokens**

### 4. Verify

Try any AWX tool:

```
awx-list-templates
```

If successful, you'll see a list of your AWX job templates.

## Troubleshooting

### "AWX client not available"

This error fires when either:
- `baseUrl` is missing from the plugin config, OR
- No PAT is stored

**Fix:** Ensure both are configured (steps 1 and 3 above).

### `/connect` shows "No results found" for "awx"

The plugin's auth provider may not appear in the standard provider list. Use the **"Other"** option (step 3 above) to manually register the credential with provider ID `awx`.

### Token validation fails on startup

If you see "Init-time token validation failed" in logs:
- Your PAT may be expired — generate a new one at AAP → Profile → Tokens
- The PAT may lack permissions — ensure it has at least Read access

## Available Tools

| Tool | Description |
|------|-------------|
| `awx-list-templates` | List AWX job templates |
| `awx-list-projects` | List AWX projects |
| `awx-launch-job` | Launch a job template (returns job ID) |
| `awx-job-status` | Get structured job detail |
| `awx-wait-job` | Non-blocking job status check |
| `awx-get-job-events` | Retrieve job events |
| `awx-sync-project` | Trigger a project sync |
