using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using LanVault.Agent.Models;

namespace LanVault.Agent.Services;

public sealed class AgentUpdateManager(
    AgentApiClient apiClient,
    ILogger<AgentUpdateManager> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task ScheduleAsync(
        string deviceId,
        string token,
        AgentCommand command,
        CancellationToken cancellationToken)
    {
        var payload = command.Payload.Deserialize<UpdateAgentCommandPayload>(JsonOptions)
            ?? throw new InvalidDataException("Agent update command has no payload.");
        var buildHash = payload.BuildHash?.ToUpperInvariant();
        if (buildHash is null || !Regex.IsMatch(buildHash, "^[A-F0-9]{64}$", RegexOptions.CultureInvariant))
            throw new InvalidDataException("Agent update command has an invalid build hash.");
        if (buildHash == Configuration.AgentVersion.BuildHash)
        {
            logger.LogInformation("Agent {DeviceId} already has update build {Version}.", deviceId, payload.Version);
            if (!string.IsNullOrWhiteSpace(command.Id))
                await apiClient.CompleteCommandAsync(deviceId, command.Id, token, cancellationToken);
            return;
        }

        var stateDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "LanVault", "Agent", "Updates");
        Directory.CreateDirectory(stateDirectory);
        var stagedExecutable = Path.Combine(stateDirectory, $"LanVault.Agent.{Guid.NewGuid():N}.exe");
        try
        {
            await apiClient.ReportAgentUpdateStatusAsync(deviceId, token, "downloading", null, cancellationToken);
            using var downloadTimeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            downloadTimeout.CancelAfter(TimeSpan.FromMinutes(15));
            await apiClient.DownloadAgentUpdateAsync(deviceId, buildHash, token, stagedExecutable, downloadTimeout.Token);
            await using var stream = File.OpenRead(stagedExecutable);
            var actualHash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken));
            if (!actualHash.Equals(buildHash, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("Downloaded Agent update failed SHA-256 verification.");

            var currentExecutable = Environment.ProcessPath
                ?? throw new InvalidOperationException("Could not determine the current Agent executable path.");
            await apiClient.ReportAgentUpdateStatusAsync(deviceId, token, "installing", null, cancellationToken);
            StartUpdateHelper(stagedExecutable, currentExecutable);
            logger.LogInformation("Verified Agent update {Version} for device {DeviceId}; helper will replace the service executable.", payload.Version, deviceId);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            try { if (File.Exists(stagedExecutable)) File.Delete(stagedExecutable); }
            catch (Exception cleanupException) when (cleanupException is IOException or UnauthorizedAccessException)
            {
                logger.LogWarning(cleanupException, "Could not remove staged Agent update {Path}.", stagedExecutable);
            }
            if (exception is not OperationCanceledException)
            {
                try
                {
                    await apiClient.ReportAgentUpdateStatusAsync(
                        deviceId,
                        token,
                        "failed",
                        exception.Message.Length <= 2000 ? exception.Message : exception.Message[..2000],
                        cancellationToken);
                }
                catch (Exception reportException) when (reportException is HttpRequestException or IOException or OperationCanceledException)
                {
                    logger.LogWarning(reportException, "Could not report the Agent update failure to the server.");
                }
            }
            throw;
        }
    }

    private static void StartUpdateHelper(string stagedExecutable, string currentExecutable)
    {
        var logPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "LanVault", "Agent", "agent-update.log");
        var processId = Environment.ProcessId;
        var script = $$"""
            $ErrorActionPreference = 'Stop'
            $serviceName = 'LanVaultAgent'
            $source = '{{EscapePowerShell(stagedExecutable)}}'
            $destination = '{{EscapePowerShell(currentExecutable)}}'
            $backup = $destination + '.previous'
            $logPath = '{{EscapePowerShell(logPath)}}'
            $agentPid = {{processId}}
            Start-Transcript -Path $logPath -Append | Out-Null
            try {
              Stop-Service -Name $serviceName -Force
              $deadline = (Get-Date).AddSeconds(60)
              while (Get-Process -Id $agentPid -ErrorAction SilentlyContinue) {
                if ((Get-Date) -ge $deadline) { throw 'Timed out waiting for the Agent service to stop.' }
                Start-Sleep -Milliseconds 500
              }
              Copy-Item -LiteralPath $destination -Destination $backup -Force
              Move-Item -LiteralPath $source -Destination $destination -Force
              Start-Service -Name $serviceName
              (Get-Service -Name $serviceName).WaitForStatus(
                [System.ServiceProcess.ServiceControllerStatus]::Running,
                [TimeSpan]::FromSeconds(60))
            } catch {
              try {
                if ((Get-Service -Name $serviceName).Status -ne 'Stopped') {
                  Stop-Service -Name $serviceName -Force
                }
              } catch {}
              if (Test-Path -LiteralPath $backup) {
                Copy-Item -LiteralPath $backup -Destination $destination -Force
              }
              if ((Get-Service -Name $serviceName).Status -eq 'Stopped') {
                Start-Service -Name $serviceName
              }
              throw
            } finally {
              Stop-Transcript | Out-Null
            }
            """;
        var encodedScript = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        var startInfo = new ProcessStartInfo
        {
            FileName = Path.Combine(Environment.SystemDirectory, "WindowsPowerShell", "v1.0", "powershell.exe"),
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add("-NoLogo");
        startInfo.ArgumentList.Add("-NoProfile");
        startInfo.ArgumentList.Add("-NonInteractive");
        startInfo.ArgumentList.Add("-ExecutionPolicy");
        startInfo.ArgumentList.Add("Bypass");
        startInfo.ArgumentList.Add("-EncodedCommand");
        startInfo.ArgumentList.Add(encodedScript);
        using var helper = Process.Start(startInfo)
            ?? throw new InvalidOperationException("Could not start the Agent update helper.");
    }

    private static string EscapePowerShell(string value) => value.Replace("'", "''", StringComparison.Ordinal);
}
