$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = Join-Path $root 'backend'
$frontend = Join-Path $root 'frontend'
$envPath = Join-Path $backend '.env'
$ports = @(3031, 3030)
$apiProcess = $null
$webProcess = $null

function Test-PortBindable([int]$Port) {
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
        $listener.Start()
        return $true
    } catch {
        return $false
    } finally {
        if ($listener) { $listener.Stop() }
    }
}

function Stop-PortListener([int]$Port) {
    for ($attempt = 1; $attempt -le 6; $attempt++) {
        $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
        if (-not $listeners -or $listeners.Count -eq 0) {
            if (Test-PortBindable -Port $Port) { return }
            throw "Port $Port is not held by any process but cannot be bound. It is likely reserved by Windows (Hyper-V/Docker/Winnat). Restart Windows, then run this launcher again. (Check: netsh interface ipv4 show excludedportrange protocol=tcp)"
        }
        foreach ($listener in $listeners) {
            Write-Host "Port $Port is already in use. Stopping process $($listener.OwningProcess) (attempt $attempt)..." -ForegroundColor Yellow
            & taskkill /PID $listener.OwningProcess /T /F 2>$null | Out-Null
            if ($LASTEXITCODE -ne 0) {
                Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep -Milliseconds 800
    }

    throw "Could not free port $Port after several attempts. Run this launcher as Administrator and try again."
}

function Stop-LanVaultProcess([System.Diagnostics.Process]$Process) {
    if ($Process -and -not $Process.HasExited) {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
}

try {
    if (-not (Test-Path -LiteralPath $envPath)) {
        Copy-Item -LiteralPath (Join-Path $backend '.env.example') -Destination $envPath
    }

    $envLines = [System.Collections.Generic.List[string]]::new()
    foreach ($line in Get-Content -LiteralPath $envPath) {
        $envLines.Add($line)
    }
    foreach ($name in @('AGENT_BOOTSTRAP_TOKEN', 'AUTH_TOKEN_SECRET')) {
        $entry = $envLines | Where-Object { $_ -match ('^' + $name + '=') } | Select-Object -First 1
        if (-not $entry -or $entry.Length -eq ($name.Length + 1)) {
            $secret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
            if ($entry) {
                $index = $envLines.IndexOf($entry)
                $envLines[$index] = "$name=$secret"
            }
            else {
                $envLines.Add("$name=$secret")
            }
        }
    }
    [System.IO.File]::WriteAllLines($envPath, $envLines, [System.Text.UTF8Encoding]::new($false))

    foreach ($port in $ports) {
        Stop-PortListener -Port $port
    }

    $env:PORT = '3031'
    Write-Host 'Starting API and frontend in this terminal...' -ForegroundColor Cyan
    $apiProcess = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', 'npm.cmd start') -WorkingDirectory $backend -NoNewWindow -PassThru
    $webProcess = Start-Process -FilePath $env:ComSpec -ArgumentList @('/d', '/s', '/c', 'npm.cmd run dev -- --host 0.0.0.0 --port 3030') -WorkingDirectory $frontend -NoNewWindow -PassThru

    Write-Host ''
    Write-Host 'LanVault is running. API: http://localhost:3031  Web: http://localhost:3030' -ForegroundColor Green
    Write-Host 'Both services share this terminal. Press Ctrl+C to stop them.' -ForegroundColor Gray

    while (-not $apiProcess.HasExited -and -not $webProcess.HasExited) {
        Start-Sleep -Seconds 1
        $apiProcess.Refresh()
        $webProcess.Refresh()
    }

    if ($apiProcess.HasExited) {
        Write-Warning "The API process exited with code $($apiProcess.ExitCode). Stopping the frontend."
    }
    else {
        Write-Warning "The frontend process exited with code $($webProcess.ExitCode). Stopping the API."
    }
}
catch {
    Write-Error $_
}
finally {
    Stop-LanVaultProcess -Process $apiProcess
    Stop-LanVaultProcess -Process $webProcess

    foreach ($port in $ports) {
        $listeners = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
        foreach ($listener in $listeners) {
            $process = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $listener.OwningProcess) -ErrorAction SilentlyContinue
            if ($process -and (($port -eq 3031 -and $process.CommandLine -match 'server\.js') -or
                    ($port -eq 3030 -and $process.CommandLine -match 'vite'))) {
                Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
            }
        }
    }
    Remove-Item Env:PORT -ErrorAction SilentlyContinue
    Write-Host 'LanVault processes stopped.' -ForegroundColor Yellow
}
