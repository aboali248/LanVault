@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ports = @(3031,3030); foreach ($port in $ports) { $connections = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue; foreach ($connection in $connections) { $process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $connection.OwningProcess); $command = $process.CommandLine; $isLanVaultApi = ($port -eq 3031 -and $command -match 'server\.js' -and $command -match '--title=LanVault'); $isLanVaultWeb = ($port -eq 3030 -and $command -match 'vite' -and $command -match '--port 3030'); if ($isLanVaultApi -or $isLanVaultWeb) { Stop-Process -Id $process.ProcessId -Force; Write-Host ('Stopped LanVault process ' + $process.ProcessId + ' on port ' + $port) } else { Write-Warning ('Port ' + $port + ' belongs to another app; it was left running.') } } }"
if errorlevel 1 (
  echo Could not stop LanVault services. Run this file as Administrator if needed.
  exit /b 1
)
echo LanVault stop check completed.
endlocal
