# setup-workbench.cmd 对应的 PowerShell 实现：先确保 Node.js 可用（缺失时自动下载本地运行时），再运行安装引导。
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)

$ErrorActionPreference = "Stop"
$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\..'))
. (Join-Path $PSScriptRoot 'ensure-node.ps1')
$nodePath = Ensure-Node -ProjectRoot $projectRoot
& $nodePath (Join-Path (Join-Path (Join-Path $projectRoot 'scripts') 'runtime') 'setup.mjs') @Rest
exit $LASTEXITCODE
