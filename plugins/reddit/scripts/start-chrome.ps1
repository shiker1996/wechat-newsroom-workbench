param(
  [int]$Port = 9333,
  [switch]$ValidateOnly,
  [string]$ProfilePath = ''
)

$profilePath = if ($ProfilePath) { [System.IO.Path]::GetFullPath($ProfilePath) } else { [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..\..\data\plugin-runtime\reddit-collector\profiles\default')) }
$programFilesX86 = [Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
$chromeCandidates = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  $(if ($programFilesX86) { Join-Path $programFilesX86 'Google\Chrome\Application\chrome.exe' }),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { $_ }

$chromePath = $chromeCandidates |
  Where-Object { Test-Path -LiteralPath $_ } |
  Select-Object -First 1

if (-not $chromePath) {
  Write-Error 'Google Chrome was not found. Add chrome.exe to the candidate list in this script.'
  exit 1
}

if ($ValidateOnly) {
  Write-Host "Chrome: $chromePath"
  Write-Host "Profile: $profilePath"
  Write-Host "CDP port: $Port"
  exit 0
}

New-Item -ItemType Directory -Force -Path $profilePath | Out-Null
try {
  $ready = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 2
  if ($ready.webSocketDebuggerUrl) {
    Write-Host "Reddit Chrome is already running. CDP port: $Port"
    exit 0
  }
} catch {}
$startInfo = [System.Diagnostics.ProcessStartInfo]::new()
$startInfo.FileName = $chromePath
$startInfo.Arguments = "--remote-debugging-port=$Port --user-data-dir=`"$profilePath`" --no-first-run --new-window https://old.reddit.com/r/programming/hot/"
$startInfo.UseShellExecute = $true
[System.Diagnostics.Process]::Start($startInfo) | Out-Null

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  try {
    $ready = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json/version" -TimeoutSec 1
    if ($ready.webSocketDebuggerUrl) {
      Write-Host "Reddit Chrome started and CDP is ready. Port: $Port"
      Write-Host 'Sign in to Reddit in this window once. The dedicated profile will keep the session.'
      exit 0
    }
  } catch {}
  Start-Sleep -Milliseconds 500
}

Write-Error "Chrome started but CDP did not become ready on 127.0.0.1:$Port"
exit 1
