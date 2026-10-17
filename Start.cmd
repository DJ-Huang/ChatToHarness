@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start.ps1"
if errorlevel 1 (
  echo.
  echo ChatToHarness could not start. Review the message above and try again.
  pause
  exit /b 1
)
