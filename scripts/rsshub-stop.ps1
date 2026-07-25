param(
    [string]$PidFile = "",
    [int]$Port = 1200
)

$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($PidFile)) { $PidFile = Join-Path $projectRoot "data\rsshub.pid" }
$PidFile = [System.IO.Path]::GetFullPath($PidFile)
$stopped = $false

if (Test-Path -LiteralPath $PidFile -PathType Leaf) {
    $stored = (Get-Content -LiteralPath $PidFile -Raw -ErrorAction SilentlyContinue).Trim()
    if ($stored -match '^\d+$') {
        & taskkill.exe /PID $stored /T /F 2>$null | Out-Null
        Write-Output "Stopped RSSHub process tree rooted at PID $stored"
        $stopped = $true
    }
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
}

if (-not $stopped) {
    $line = netstat -ano | Select-String "LISTENING\s+\d+$" | Where-Object { $_.ToString() -match "(?:127\.0\.0\.1|0\.0\.0\.0|\[::\]):$Port\s" } | Select-Object -First 1
    if ($line) {
        $processId = [int]($line.ToString().Trim().Split()[-1])
        & taskkill.exe /PID $processId /T /F 2>$null | Out-Null
        Write-Output "Stopped process $processId listening on port $Port"
    } else {
        Write-Output "RSSHub is not running on port $Port"
    }
}
