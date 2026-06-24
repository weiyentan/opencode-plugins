$auth = Get-Content "$env:USERPROFILE\.local\share\opencode\auth.json" | ConvertFrom-Json
$env:AWX_TOKEN = $auth.awx.key
$env:AWX_BASE_URL = "https://aap.tanscloud-internal.com"

Write-Host "=== AWX Plugin Debug Test ===" -ForegroundColor Cyan
Write-Host "AWX_TOKEN: $($env:AWX_TOKEN.Substring(0, 8))..." -ForegroundColor Yellow
Write-Host "AWX_BASE_URL: $env:AWX_BASE_URL" -ForegroundColor Yellow

# Clean old debug logs
Remove-Item "$env:TEMP\awx-debug.log" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:TEMP\awx-debug-*.log" -Force -ErrorAction SilentlyContinue

Write-Host "Starting OpenCode... (check stderr for [AWX-STARTUP] lines)" -ForegroundColor Yellow

& opencode

Write-Host "`n=== Debug Log Files ===" -ForegroundColor Cyan
Get-ChildItem "$env:TEMP\awx-debug-*.log" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "`n--- $($_.Name) ---" -ForegroundColor Yellow
    Get-Content $_.FullName
}
if (-not (Get-ChildItem "$env:TEMP\awx-debug-*.log" -ErrorAction SilentlyContinue)) {
    Write-Host "No debug log files found" -ForegroundColor Red
}
