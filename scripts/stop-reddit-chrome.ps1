param([int]$Port = 9222)

$profilePath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\data\reddit-chrome-profile'))
$matches = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" |
  Where-Object { $_.CommandLine -and $_.CommandLine.Contains("--remote-debugging-port=$Port") -and $_.CommandLine.Contains($profilePath) }

if (-not $matches) {
  Write-Output "Reddit Chrome is not running on CDP port $Port"
  exit 0
}

$matches | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Output "Reddit Chrome stopped ($($matches.Count) processes)"
