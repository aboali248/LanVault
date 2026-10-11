using LanVault.Agent.Configuration;
using LanVault.Agent.Models;
using LanVault.Agent.Services;
using Microsoft.Extensions.Options;

namespace LanVault.Agent.Workers;

public sealed class AgentWorker(
    AgentApiClient apiClient,
    DeviceInspector inspector,
    AgentIdentityStore identityStore,
    AgentRuntimeState runtime,
    BackupManager backups,
    RestoreManager restores,
    AgentUpdateManager updates,
    IOptions<AgentOptions> options,
    ILogger<AgentWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        identityStore.WriteInstallerStatus("starting", "Agent service is starting.");
        try
        {
            var identity = identityStore.Load();
            using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.Value.HeartbeatIntervalSeconds));
            do
            {
                try
                {
                    if (string.IsNullOrWhiteSpace(identity.DeviceId) || string.IsNullOrWhiteSpace(identity.AgentToken))
                        identity = await RegisterAsync(identity, stoppingToken);

                    var heartbeat = await apiClient.HeartbeatAsync(
                        identity.DeviceId!,
                        identity.AgentToken!,
                        new HeartbeatRequest
                        {
                            Status = runtime.HasRunningBackups ? "busy" : "online",
                            AgentVersion = AgentVersion.Current,
                            AgentBuildHash = AgentVersion.BuildHash,
                            Disks = inspector.CollectDisks(),
                        },
                        stoppingToken);
                    identityStore.WriteInstallerStatus("connected", "Agent successfully contacted the LanVault server.", identity.DeviceId);
                    foreach (var command in heartbeat.Commands)
                        await ProcessCommandAsync(command, identity, stoppingToken);
                }
                catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested) { break; }
                catch (HttpRequestException exception) when (exception.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                {
                    logger.LogWarning("Agent credentials were rejected; attempting registration again.");
                    identityStore.WriteInstallerStatus("error", exception.Message);
                    identity.DeviceId = null;
                    identity.AgentToken = null;
                    identityStore.Save(identity);
                }
                catch (Exception exception)
                {
                    logger.LogError(exception, "LanVault agent heartbeat failed; it will retry after the configured interval.");
                    identityStore.WriteInstallerStatus("error", exception.Message);
                }
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            identityStore.WriteInstallerStatus("error", exception.Message);
            throw;
        }
    }

    private async Task<AgentIdentityState> RegisterAsync(AgentIdentityState identity, CancellationToken cancellationToken)
    {
        var registration = inspector.CollectRegistration(options.Value.BootstrapToken);
        var response = await apiClient.RegisterAsync(registration, cancellationToken);
        if (string.IsNullOrWhiteSpace(response.Device?.Id) || string.IsNullOrWhiteSpace(response.AgentToken))
            throw new InvalidDataException("The server returned incomplete agent enrollment credentials.");
        identity.DeviceId = response.Device.Id;
        identity.AgentToken = response.AgentToken;
        identity.MacAddress = registration.MacAddress;
        identity.RegisteredAt = DateTimeOffset.UtcNow;
        identityStore.Save(identity);
        identityStore.WriteInstallerStatus("registered", "Agent registered and is waiting for its first heartbeat.", identity.DeviceId);
        logger.LogInformation("Registered with LanVault as {DeviceId}. The device remains pending administrator approval.", identity.DeviceId);
        return identity;
    }

    private async Task ProcessCommandAsync(AgentCommand command, AgentIdentityState identity, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(command.Id) || string.IsNullOrWhiteSpace(command.Type)) return;
        var wasProcessed = identity.ProcessedCommandIds.Contains(command.Id, StringComparer.OrdinalIgnoreCase);
        if (wasProcessed)
        {
            if (command.Type.Equals("backup", StringComparison.OrdinalIgnoreCase))
                backups.Start(identity.DeviceId!, identity.AgentToken!, command);
            else if (command.Type.Equals("stop_backup", StringComparison.OrdinalIgnoreCase))
                await backups.StopAsync(identity.DeviceId!, identity.AgentToken!, command, cancellationToken);
            else if (command.Type.Equals("restore_file", StringComparison.OrdinalIgnoreCase))
            {
                await restores.ExecuteAsync(identity.DeviceId!, identity.AgentToken!, command, cancellationToken);
                await apiClient.CompleteCommandAsync(identity.DeviceId!, command.Id, identity.AgentToken!, cancellationToken);
            }
            else if (command.Type.Equals("update_agent", StringComparison.OrdinalIgnoreCase))
                await apiClient.CompleteCommandAsync(identity.DeviceId!, command.Id, identity.AgentToken!, cancellationToken);
            return;
        }
        await apiClient.AcknowledgeAsync(identity.DeviceId!, command.Id, identity.AgentToken!, cancellationToken);
        if (command.Type.Equals("backup", StringComparison.OrdinalIgnoreCase))
        {
            backups.Start(identity.DeviceId!, identity.AgentToken!, command);
        }
        else if (command.Type.Equals("stop_backup", StringComparison.OrdinalIgnoreCase))
        {
            await backups.StopAsync(identity.DeviceId!, identity.AgentToken!, command, cancellationToken);
        }
        else if (command.Type.Equals("restore_file", StringComparison.OrdinalIgnoreCase))
        {
            await restores.ExecuteAsync(identity.DeviceId!, identity.AgentToken!, command, cancellationToken);
            await apiClient.CompleteCommandAsync(identity.DeviceId!, command.Id, identity.AgentToken!, cancellationToken);
        }
        else if (command.Type.Equals("update_agent", StringComparison.OrdinalIgnoreCase))
        {
            _ = RunAgentUpdateAsync(identity.DeviceId!, identity.AgentToken!, command, cancellationToken);
        }
        else
        {
            logger.LogWarning("Ignoring unsupported command type {CommandType}.", command.Type);
            await apiClient.CompleteCommandAsync(identity.DeviceId!, command.Id, identity.AgentToken!, cancellationToken);
        }
        identity.ProcessedCommandIds.Add(command.Id);
        if (identity.ProcessedCommandIds.Count > 1000) identity.ProcessedCommandIds.RemoveRange(0, identity.ProcessedCommandIds.Count - 1000);
        identityStore.Save(identity);
    }

    private async Task RunAgentUpdateAsync(string deviceId, string token, AgentCommand command, CancellationToken cancellationToken)
    {
        try
        {
            await updates.ScheduleAsync(deviceId, token, command, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Agent update command {CommandId} failed for device {DeviceId}.", command.Id, deviceId);
        }
    }
}
