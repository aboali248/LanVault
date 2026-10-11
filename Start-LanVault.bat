@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-LanVault.ps1"
echo.
pause
endlocal
