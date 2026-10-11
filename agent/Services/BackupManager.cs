using System.Text.Json;
using LanVault.Agent.Configuration;
using LanVault.Agent.Models;
using Microsoft.Extensions.Options;

namespace LanVault.Agent.Services;

public sealed class BackupManager(
    AgentApiClient apiClient,
    BackupExecutor executor,
    AgentRuntimeState runtime,
    IOptions<AgentOptions> options,
    ILogger<BackupManager> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly SemaphoreSlim _parallelism = new(options.Value.MaxConcurrentBackups);

    public void Start(string deviceId, string token, AgentCommand command)
    {
        var commandId = command.Id ?? throw new InvalidDataException("Backup command has no ID.");
        var payload = command.Payload.Deserialize<BackupCommandPayload>(JsonOptions)
            ?? throw new InvalidDataException("Backup command has no payload.");
        if (string.IsNullOrWhiteSpace(payload.BackupId) || string.IsNullOrWhiteSpace(payload.Destination) || payload.Disks is null)
            throw new InvalidDataException("Backup command is incomplete.");
        var cancellation = new CancellationTokenSource();
        if (!runtime.TryStart(payload.BackupId, cancellation)) { cancellation.Dispose(); return; }
        var request = new BackupExecutionRequest
        {
            BackupId = payload.BackupId,
            DeviceId = deviceId,
            DestinationSlot = "primary",
            Mode = payload.Mode ?? "incremental",
            Destination = payload.Destination,
            SecondaryDestination = payload.SecondaryDestination,
            Disks = payload.Disks,
            ExcludedExtensions = payload.ExcludedExtensions ?? Array.Empty<string>(),
        };
        _ = Task.Run(() => RunJobAsync(deviceId, token, commandId, request, payload.MaxTransferRateMbps, payload.RetentionCount, cancellation));
    }

    public async Task StopAsync(string deviceId, string token, AgentCommand command, CancellationToken cancellationToken)
    {
        var commandId = command.Id ?? throw new InvalidDataException("Stop command has no ID.");
        var payload = command.Payload.Deserialize<CancelBackupCommandPayload>(JsonOptions);
        if (string.IsNullOrWhiteSpace(payload?.BackupId)) throw new InvalidDataException("Stop command has no backup ID.");
        if (!runtime.Stop(payload.BackupId))
        {
            await apiClient.ReportProgressAsync(deviceId, payload.BackupId, token, new BackupProgressRequest
            {
                Status = "cancelled", ProgressPercent = 0, CompletedAt = DateTimeOffset.UtcNow,
                ErrorMessage = "Backup was stopped while the agent was offline.",
            }, cancellationToken);
        }
        await apiClient.CompleteCommandAsync(deviceId, commandId, token, cancellationToken);
    }

    private async Task RunJobAsync(
        string deviceId,
        string token,
        string commandId,
        BackupExecutionRequest request,
        double? maxTransferRateMbps,
        int? retentionCount,
        CancellationTokenSource cancellation)
    {
        var acquired = false;
        try
        {
            await _parallelism.WaitAsync(cancellation.Token);
            acquired = true;
            var started = DateTimeOffset.UtcNow;
            var lastProgressPercent = 0;
            long? lastBytesProcessed = 0;
            long? lastTotalBytes = null;
            try
            {
                // The agent uploads once (primary). The server replicates content
                // to the secondary destination itself, so the LAN is never
                // used for the second copy.
                BackupExecutionRequest ForDestination(string destination, string destinationSlot) => new()
                {
                    BackupId = request.BackupId,
                    DeviceId = request.DeviceId,
                    DestinationSlot = destinationSlot,
                    Mode = request.Mode,
                    Destination = destination,
                    Disks = request.Disks,
                    ExcludedExtensions = request.ExcludedExtensions,
                };
                var primaryResult = await executor.ExecuteAsync(
                    ForDestination(request.Destination, "primary"),
                    token,
                    maxTransferRateMbps,
                    progress =>
                    {
                        lastProgressPercent = progress.ProgressPercent;
                        lastBytesProcessed = progress.BytesProcessed;
                        lastTotalBytes = progress.TotalBytes;
                        return apiClient.ReportProgressAsync(deviceId, request.BackupId, token, progress, cancellation.Token);
                    },
                    cancellation.Token);
                var result = primaryResult;
                await apiClient.ReportProgressAsync(deviceId, request.BackupId, token, new BackupProgressRequest
                {
                    Status = "completed", ProgressPercent = 100, BytesProcessed = result.CopiedBytes,
                    TotalBytes = result.TotalBytes, BackupSizeBytes = result.CopiedBytes,
                    StartedAt = started, CompletedAt = DateTimeOffset.UtcNow,
                    RetentionCount = retentionCount,
                    InventoryComplete = result.InventoryComplete,
                    InventoryMode = result.InventoryMode,
                }, cancellation.Token);
                if (result.WarningCount > 0) logger.LogWarning("Backup {BackupId} completed with {WarningCount} inaccessible files.", request.BackupId, result.WarningCount);
            }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
            {
                await apiClient.ReportProgressAsync(deviceId, request.BackupId, token, new BackupProgressRequest
                {
                    Status = "cancelled", ProgressPercent = lastProgressPercent, BytesProcessed = lastBytesProcessed,
                    TotalBytes = lastTotalBytes, StartedAt = started, CompletedAt = DateTimeOffset.UtcNow,
                    ErrorMessage = "Backup stopped by administrator.",
                }, CancellationToken.None);
            }
            catch (Exception exception)
            {
                logger.LogError(exception, "Backup {BackupId} failed.", request.BackupId);
                await apiClient.ReportProgressAsync(deviceId, request.BackupId, token, new BackupProgressRequest
                {
                    Status = "failed", ProgressPercent = lastProgressPercent, BytesProcessed = lastBytesProcessed,
                    TotalBytes = lastTotalBytes, StartedAt = started, CompletedAt = DateTimeOffset.UtcNow,
                    ErrorMessage = exception.Message.Length > 2000 ? exception.Message[..2000] : exception.Message,
                }, CancellationToken.None);
            }
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested)
        {
            logger.LogInformation("Backup {BackupId} was cancelled before starting.", request.BackupId);
            try
            {
                await apiClient.ReportProgressAsync(deviceId, request.BackupId, token, new BackupProgressRequest
                {
                    Status = "cancelled", ProgressPercent = 0, CompletedAt = DateTimeOffset.UtcNow,
                    ErrorMessage = "Backup stopped before the agent began processing it.",
                }, CancellationToken.None);
            }
            catch (HttpRequestException exception) { logger.LogError(exception, "Could not report cancellation for backup {BackupId}.", request.BackupId); }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Backup worker failed unexpectedly for {BackupId}.", request.BackupId);
            var diagnostic = $"Backup worker failed before reporting its result: {exception.GetType().Name}: {exception.Message}";
            if (diagnostic.Length > 2000) diagnostic = diagnostic[..2000];
            try
            {
                await apiClient.ReportBackupLogAsync(
                    deviceId,
                    request.BackupId,
                    token,
                    "error",
                    diagnostic,
                    CancellationToken.None);
            }
            catch (Exception reportException)
            {
                logger.LogError(reportException, "Could not report the failure details for backup {BackupId}.", request.BackupId);
            }
        }
        finally
        {
            if (acquired) _parallelism.Release();
            runtime.Complete(request.BackupId);
            try { await apiClient.CompleteCommandAsync(deviceId, commandId, token, CancellationToken.None); }
            catch (HttpRequestException exception) { logger.LogError(exception, "Could not acknowledge completion for command {CommandId}.", commandId); }
        }
    }
}
