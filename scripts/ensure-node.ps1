# Node.js bootstrap (dot-sourced by start-workbench.ps1 / setup-workbench.ps1).
# When node>=24 is missing, downloads the official runtime into .node-runtime\
# and prepends it to PATH for the current session only; the system environment
# is not modified. Override via NODE_BOOTSTRAP_VERSION / NODE_BOOTSTRAP_DIST (mirror).
# NOTE: keep this file pure ASCII (no BOM) like the other .ps1 files in this repo;
# PowerShell 5.1 misreads UTF-8-without-BOM multibyte comments and swallows code.
$script:NodeBootstrapVersion = if ($env:NODE_BOOTSTRAP_VERSION) { $env:NODE_BOOTSTRAP_VERSION } else { '24.12.0' }
$script:NodeBootstrapDist = if ($env:NODE_BOOTSTRAP_DIST) { $env:NODE_BOOTSTRAP_DIST } else { 'https://nodejs.org/dist' }

function Ensure-Node {
  param([string]$ProjectRoot)
  $node = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($node) {
    $major = [int]((& $node.Source -p "process.versions.node.split('.')[0]") 2>$null)
    if ($major -ge 24) { return $node.Source }
  }
  $runtimeDir = Join-Path $ProjectRoot ".node-runtime\node-v$script:NodeBootstrapVersion"
  $localNode = Join-Path $runtimeDir 'node.exe'
  if (Test-Path $localNode) {
    $env:Path = "$runtimeDir;$env:Path"
    return $localNode
  }
  if (-not [Environment]::Is64BitOperatingSystem) {
    throw "Node.js 24+ not found, and automatic install only supports 64-bit Windows. Please install Node.js manually: https://nodejs.org/"
  }
  $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'x64' }
  $name = "node-v$script:NodeBootstrapVersion-win-$arch"
  $base = "$script:NodeBootstrapDist/v$script:NodeBootstrapVersion"
  $tmp = Join-Path $ProjectRoot ".node-runtime\.download-$name"
  Write-Host "Node.js 24+ not found. Downloading $name to .node-runtime\ (system environment is not modified)..."
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Path $tmp -Force | Out-Null
  try {
    Invoke-WebRequest -Uri "$base/$name.zip" -OutFile (Join-Path $tmp 'node.zip') -UseBasicParsing
    Invoke-WebRequest -Uri "$base/SHASUMS256.txt" -OutFile (Join-Path $tmp 'SHASUMS256.txt') -UseBasicParsing
  } catch {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    throw "Failed to download the Node.js runtime. Check your network or set NODE_BOOTSTRAP_DIST to a mirror, then retry. $_"
  }
  $expected = ((Select-String -Path (Join-Path $tmp 'SHASUMS256.txt') -Pattern " $name\.zip$" | ForEach-Object { $_.Line }) -split '\s+')[0]
  $actual = (Get-FileHash (Join-Path $tmp 'node.zip') -Algorithm SHA256).Hash.ToLower()
  if ($expected -and $actual -and $expected -ne $actual) {
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
    throw "Node.js runtime checksum mismatch. Aborted."
  }
  Expand-Archive -Path (Join-Path $tmp 'node.zip') -DestinationPath $tmp -Force
  Remove-Item -Recurse -Force $runtimeDir -ErrorAction SilentlyContinue
  Move-Item (Join-Path $tmp $name) $runtimeDir
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
  $env:Path = "$runtimeDir;$env:Path"
  Write-Host "Node.js $(& $localNode -v) is ready (.node-runtime\)."
  return $localNode
}
