# rsshub-stop.ps1
$pidFile = "E:\Documents\write-assistant\rsshub.pid"
if (Test-Path $pidFile) {
    $pidStr = Get-Content $pidFile -Raw -ErrorAction SilentlyContinue
    if ($pidStr) {
        $rssPid = [int]$pidStr.Trim()
        Stop-Process -Id $rssPid -Force -ErrorAction SilentlyContinue
        Write-Output "Stopped RSSHub (PID: $rssPid)"
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
} else {
    Write-Output "No PID file found, checking port 1200..."
    $proc = netstat -ano | Select-String "0.0.0.0:1200 " | ForEach-Object { $_.ToString().Trim().Split()[-1] }
    if ($proc) { Stop-Process -Id $proc -Force -ErrorAction SilentlyContinue; Write-Output "Stopped process on port 1200" }
}
