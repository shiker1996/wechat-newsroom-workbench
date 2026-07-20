# rsshub-start.ps1 - Start RSSHub in dev mode
param([int]$MaxRetries = 1)

$ErrorActionPreference = "Stop"
$rsshubDir = "E:\Documents\write-assistant\RSSHub"
$pidFile = "$env:USERPROFILE\.openclaw\workspace\rsshub.pid"
$port = 1200

# Check if already running
$existing = netstat -ano | Select-String "0.0.0.0:${port} "
if ($existing) {
    Write-Output "RSSHub already running on port ${port}"
    # Verify routes
    $resp = try { Invoke-WebRequest -Uri "http://localhost:${port}/huxiu/article?limit=3" -TimeoutSec 10 -UseBasicParsing } catch { $null }
    if ($resp -and $resp.StatusCode -eq 200) {
        Write-Output "Route check passed"
        exit 0
    }
    Write-Output "Route check failed, restarting..."
    # Kill existing
    $pidLine = $existing | Select-String "LISTENING" | ForEach-Object { $_.ToString().Trim().Split()[-1] }
    if ($pidLine) { Stop-Process -Id $pidLine -Force -ErrorAction SilentlyContinue }
    Start-Sleep -Seconds 2
}

# Start in background
$logFile = "$rsshubDir\logs\rsshub-dev.log"
if (-not (Test-Path (Split-Path $logFile -Parent))) { New-Item -ItemType Directory -Path (Split-Path $logFile -Parent) -Force | Out-Null }

$process = Start-Process -FilePath "npx.cmd" -ArgumentList "tsx lib/index.ts" -WorkingDirectory $rsshubDir -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError "${logFile}.err"
$process.Id | Out-File -FilePath $pidFile -Encoding ascii

# Wait for startup
$maxWait = 60  # seconds
$waited = 0
$ready = $false
while ($waited -lt $maxWait) {
    Start-Sleep -Seconds 2
    $waited += 2
    $resp = try { Invoke-WebRequest -Uri "http://localhost:${port}/" -TimeoutSec 5 -UseBasicParsing } catch { $null }
    if ($resp -and $resp.StatusCode -eq 200) {
        Write-Output "RSSHub started in ${waited}s (PID: $($process.Id))"
        $ready = $true
        break
    }
}

if (-not $ready) {
    Write-Error "RSSHub failed to start within ${maxWait}s"
    $retry = 0
    while ($retry -lt $MaxRetries) {
        Write-Output "Retry $($retry+1)..."
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        $process = Start-Process -FilePath "npx.cmd" -ArgumentList "tsx lib/index.ts" -WorkingDirectory $rsshubDir -NoNewWindow -PassThru -RedirectStandardOutput $logFile -RedirectStandardError "${logFile}.err"
        $process.Id | Out-File -FilePath $pidFile -Encoding ascii
        $waited = 0
        while ($waited -lt $maxWait) {
            Start-Sleep -Seconds 2; $waited += 2
            $resp = try { Invoke-WebRequest -Uri "http://localhost:${port}/" -TimeoutSec 5 -UseBasicParsing } catch { $null }
            if ($resp -and $resp.StatusCode -eq 200) { Write-Output "Started on retry $($retry+1)"; $ready = $true; break }
        }
        if ($ready) { break }
        $retry++
    }
    if (-not $ready) { Write-Error "RSSHub failed after all retries"; exit 1 }
}

# Verify key routes
Write-Output "Verifying routes..."
$routes = @("latepost", "huxiu/article", "solidot", "readhub", "jiemian/lists/65", "techcrunch/news", "infoq/recommend", "anthropic/news")
$ok = 0; $failed = 0
foreach ($route in $routes) {
    $r = try { Invoke-WebRequest -Uri "http://localhost:${port}/${route}?limit=3" -TimeoutSec 15 -UseBasicParsing } catch { $null }
    if ($r -and $r.StatusCode -eq 200) { $ok++ } else { $failed++ }
}
Write-Output "Routes verified: ${ok} ok, ${failed} failed"
