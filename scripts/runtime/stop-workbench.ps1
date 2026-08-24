param([int]$Port = 4317)

$ErrorActionPreference = "Stop"

$connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $connections) {
  Write-Output "No process is listening on port $Port. Workbench is not running."
  exit 0
}

$pids = $connections | Select-Object -ExpandProperty OwningProcess -Unique
foreach ($pidValue in $pids) {
  $process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
  if (-not $process) { continue }
  if ($process.ProcessName -ne 'node') {
    Write-Output "Port $Port is held by $($process.ProcessName) (PID $pidValue), not node.exe. Skipping."
    continue
  }
  Stop-Process -Id $pidValue -Force
  Write-Output "Stopped workbench server (PID $pidValue)."
}
