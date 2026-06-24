# Set the AWX token from auth.json
$auth = Get-Content "$env:USERPROFILE\.local\share\opencode\auth.json" | ConvertFrom-Json
$env:AWX_TOKEN = $auth.awx.key
$env:AWX_BASE_URL = "https://aap.tanscloud-internal.com"

# Start OpenCode
opencode
