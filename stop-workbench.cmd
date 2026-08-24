@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\runtime\stop-workbench.ps1" %*
if errorlevel 1 pause
