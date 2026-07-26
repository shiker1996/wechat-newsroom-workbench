param(
  [int]$Port = 9222,
  [switch]$ValidateOnly
)

$profilePath = Join-Path $PSScriptRoot '..\data\reddit-chrome-profile'
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
    Start-Process "https://old.reddit.com/r/programming/hot/"
    Write-Host "Reddit Chrome is already running. CDP port: $Port"
    exit 0
  }
} catch {}
Start-Process -FilePath $chromePath -ArgumentList @(
  "--remote-debugging-port=$Port",
  "--user-data-dir=$profilePath",
  '--no-first-run',
  'https://old.reddit.com/r/programming/hot/'
)

Write-Host "Reddit Chrome started. CDP port: $Port"
Write-Host 'Sign in to Reddit in this window once. The dedicated profile will keep the session.'
