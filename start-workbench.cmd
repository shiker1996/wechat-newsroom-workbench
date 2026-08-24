@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\runtime\start-workbench.ps1" %*
if errorlevel 1 pause
