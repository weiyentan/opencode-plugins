$auth = Get-Content "$env:USERPROFILE\.local\share\opencode\auth.json" | ConvertFrom-Json
$env:AWX_TOKEN = $auth.awx.key
$env:AWX_BASE_URL = "https://aap.tanscloud-internal.com"

Write-Host "=== AWX Plugin stderr Capture ===" -ForegroundColor Cyan
Write-Host "AWX_BASE_URL: $env:AWX_BASE_URL" -ForegroundColor Yellow
Write-Host "AWX_TOKEN: (loaded from auth.json — value not displayed for security)" -ForegroundColor Yellow

# Clean old files
Remove-Item "$env:TEMP\awx-stderr-capture.log" -Force -ErrorAction SilentlyContinue
Remove-Item "$env:TEMP\awx-debug-*.log" -Force -ErrorAction SilentlyContinue

Write-Host "Starting OpenCode with stderr capture..." -ForegroundColor Yellow
Write-Host "After testing, check: Get-Content `$env:TEMP\awx-stderr-capture.log" -ForegroundColor Yellow

# Run opencode, redirect stderr to file, keep TUI interactive
& opencode 2> "$env:TEMP\awx-stderr-capture.log"

Write-Host "`n=== stderr Contents ===" -ForegroundColor Cyan
$stderrFile = "$env:TEMP\awx-stderr-capture.log"
if (Test-Path $stderrFile) {
    $size = (Get-Item $stderrFile).Length
    Write-Host "File size: $size bytes" -ForegroundColor Yellow
    if ($size -gt 0) {
        Get-Content $stderrFile
    } else {
        Write-Host "stderr file is empty — console.error may not be captured by redirect" -ForegroundColor Red
    }
} else {
    Write-Host "stderr file not created" -ForegroundColor Red
}

Write-Host "`n=== Debug Log Files ===" -ForegroundColor Cyan
Get-ChildItem "$env:TEMP\awx-debug-*.log" -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Host "`n--- $($_.Name) ($($_.Length) bytes) ---" -ForegroundColor Yellow
    Get-Content $_.FullName
}
if (-not (Get-ChildItem "$env:TEMP\awx-debug-*.log" -ErrorAction SilentlyContinue)) {
    Write-Host "No PID-suffixed debug logs found" -ForegroundColor Red
}
