param([int]$Port = 9333, [string]$ProfilePath = '')

$profilePath = if ($ProfilePath) { [System.IO.Path]::GetFullPath($ProfilePath) } else { [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\data\reddit-chrome-profile')) }
$chromeProcesses = @()
try {
  $chromeProcesses = @(Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" -ErrorAction Stop |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains("--remote-debugging-port=$Port") -and $_.CommandLine.Contains($profilePath) })
} catch {}

if (-not $chromeProcesses) {
  $listener = netstat -ano | Select-String "^\s*TCP\s+127\.0\.0\.1:$Port\s+0\.0\.0\.0:0\s+LISTENING\s+(\d+)" | Select-Object -First 1
  if ($listener -and $listener.Matches[0].Groups[1].Value) {
    $listenerPid = [int]$listener.Matches[0].Groups[1].Value
    $process = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq 'chrome') { $chromeProcesses = @($process) }
  }
}

if (-not $chromeProcesses) {
  Write-Output "Reddit Chrome is not running on CDP port $Port"
  exit 0
}

$stopped = 0
foreach ($chromeProcess in $chromeProcesses) {
  $processId = if ($chromeProcess.ProcessId) { [int]$chromeProcess.ProcessId } else { [int]$chromeProcess.Id }
  try {
    Stop-Process -Id $processId -Force -ErrorAction Stop
    Wait-Process -Id $processId -Timeout 5 -ErrorAction SilentlyContinue
    if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) { $stopped++ }
  } catch {
    if (-not (Get-Process -Id $processId -ErrorAction SilentlyContinue)) {
      $stopped++
      continue
    }
    Write-Error "Failed to stop Reddit Chrome process ${processId}: $($_.Exception.Message)"
    exit 1
  }
}

for ($attempt = 0; $attempt -lt 10; $attempt++) {
  $listener = netstat -ano | Select-String "^\s*TCP\s+127\.0\.0\.1:$Port\s+0\.0\.0\.0:0\s+LISTENING\s+\d+" | Select-Object -First 1
  if (-not $listener) { break }
  Start-Sleep -Milliseconds 200
}
if ($listener) {
  Write-Error "Reddit Chrome did not release CDP port $Port"
  exit 1
}

Write-Output "Reddit Chrome stopped; CDP port $Port is free"
