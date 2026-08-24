param([int]$Port = 4317, [switch]$NoBrowser, [switch]$Demo)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
$address = "http://127.0.0.1:$Port/"
$healthAddress = "${address}api/overview"

function Test-Workbench {
  try {
    $response = Invoke-WebRequest -Uri $healthAddress -UseBasicParsing -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch { return $false }
}

. (Join-Path $PSScriptRoot 'ensure-node.ps1')
$nodePath = Ensure-Node -ProjectRoot $projectRoot
& $nodePath (Join-Path (Join-Path (Join-Path $projectRoot 'scripts') 'runtime') 'check-env.mjs')
if ($LASTEXITCODE -ne 0) { throw "Environment check failed. See messages above." }

if (-not (Test-Workbench)) {
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($listeners) {
    $holders = $listeners | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {
      $p = Get-Process -Id $_ -ErrorAction SilentlyContinue
      if ($p) { "$($p.ProcessName) (PID $($p.Id))" } else { "PID $_" }
    }
    throw "Port $Port is already in use by: $($holders -join ', '). Stop that process first, or run scripts\runtime\stop-workbench.ps1 if it is a previous workbench."
  }
  $logDirectory = Join-Path $projectRoot 'logs'
  New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
  $argsList = @('--disable-warning=ExperimentalWarning','server.mjs')
  if ($Demo) { $argsList += '--demo' }
  Start-Process -WindowStyle Hidden -FilePath $nodePath -ArgumentList $argsList `
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
