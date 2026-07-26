param([int]$Port = 4317, [switch]$NoBrowser)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$address = "http://127.0.0.1:$Port/"
$healthAddress = "${address}api/overview"

function Test-Workbench {
  try {
    $response = Invoke-WebRequest -Uri $healthAddress -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch { return $false }
}

$node = Get-Command node.exe -ErrorAction Stop
$major = [int]((& $node.Source --version).TrimStart('v').Split('.')[0])
if ($major -lt 24) { throw "Node.js 24 or newer is required. Current version: $(& $node.Source --version)" }

if (-not (Test-Workbench)) {
  $logDirectory = Join-Path $projectRoot 'logs'
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  Start-Process -WindowStyle Hidden -FilePath $node.Source -ArgumentList '--disable-warning=ExperimentalWarning','server.mjs' `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput (Join-Path $logDirectory 'workbench.log') `
    -RedirectStandardError (Join-Path $logDirectory 'workbench.error.log')
  $deadline = (Get-Date).AddSeconds(45)
  while ((Get-Date) -lt $deadline -and -not (Test-Workbench)) { Start-Sleep -Milliseconds 500 }
  if (-not (Test-Workbench)) {
    $detail = if (Test-Path (Join-Path $logDirectory 'workbench.error.log')) {
      (Get-Content (Join-Path $logDirectory 'workbench.error.log') -Tail 20) -join "`n"
    } else { '' }
    throw "Workbench failed to start within 45 seconds. $detail"
  }
}

if (-not $NoBrowser) { Start-Process $address }
Write-Output "Workbench is ready: $address"
