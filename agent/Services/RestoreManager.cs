using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;
using LanVault.Agent.Models;

namespace LanVault.Agent.Services;

public sealed class RestoreManager(
    AgentApiClient apiClient,
    ILogger<RestoreManager> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public async Task ExecuteAsync(
        string deviceId,
        string token,
        AgentCommand command,
        CancellationToken cancellationToken)
    {
        var commandId = command.Id ?? throw new InvalidDataException("Restore command has no ID.");
        var payload = command.Payload.Deserialize<RestoreFileCommandPayload>(JsonOptions)
            ?? throw new InvalidDataException("Restore command has no payload.");
        if (string.IsNullOrWhiteSpace(payload.Drive) ||
            string.IsNullOrWhiteSpace(payload.RelativePath) ||
            payload.SizeBytes is null or < 0 ||
            string.IsNullOrWhiteSpace(payload.Sha256) ||
            !Regex.IsMatch(payload.Sha256, "^[a-fA-F0-9]{64}$", RegexOptions.CultureInvariant))
        {
            throw new InvalidDataException("Restore command is incomplete.");
        }

        string? temporaryPath = null;
        string? errorMessage = null;
        try
        {
            var destination = GetSafeDestination(payload.Drive, payload.RelativePath);
            if (File.Exists(destination))
            {
                if (!await MatchesBackupAsync(destination, payload.SizeBytes.Value, payload.Sha256, cancellationToken))
                    throw new IOException("The destination file already exists and differs from the retained backup; it was not overwritten.");
            }
            else
            {
                Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
                temporaryPath = $"{destination}.{Guid.NewGuid():N}.restore";
                if (!string.IsNullOrWhiteSpace(payload.DeletedFileId))
                {
                    await apiClient.DownloadDeletedFileAsync(deviceId, payload.DeletedFileId, token, temporaryPath, cancellationToken);
                }
                else
                {
                    if (string.IsNullOrWhiteSpace(payload.BackupId))
                        throw new InvalidDataException("Restore command has no backup reference.");
                    await apiClient.DownloadBackupFileAsync(deviceId, payload.BackupId, payload.Drive, payload.RelativePath, token, temporaryPath, cancellationToken);
                }
                if (!await MatchesBackupAsync(temporaryPath, payload.SizeBytes.Value, payload.Sha256, cancellationToken))
                    throw new InvalidDataException("The downloaded file does not match the retained backup.");

                File.Move(temporaryPath, destination, overwrite: false);
                temporaryPath = null;
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            if (temporaryPath is not null)
            {
                try { File.Delete(temporaryPath); }
                catch (Exception cleanupError) when (cleanupError is IOException or UnauthorizedAccessException)
                {
                    logger.LogWarning(cleanupError, "Could not remove temporary restore file for command {CommandId}.", commandId);
                }
            }
            errorMessage = exception.Message.Length <= 2000 ? exception.Message : exception.Message[..2000];
        }

        if (!string.IsNullOrWhiteSpace(payload.DeletedFileId))
        {
            await apiClient.ReportDeletedFileRestoreAsync(deviceId, payload.DeletedFileId, token, errorMessage, cancellationToken);
            if (errorMessage is null)
            {
                logger.LogInformation("Restored deleted file {DeletedFileId} for device {DeviceId}.", payload.DeletedFileId, deviceId);
            }
            else
            {
                logger.LogError("Restore command {CommandId} failed for device {DeviceId}: {ErrorMessage}", commandId, deviceId, errorMessage);
            }
        }
        else
        {
            await apiClient.ReportFileRestoreAsync(deviceId, payload.BackupId!, payload.Drive, payload.RelativePath, token, errorMessage, cancellationToken);
            if (errorMessage is null)
            {
                logger.LogInformation("Restored {Drive}:\\{RelativePath} from backup {BackupId} for device {DeviceId}.", payload.Drive, payload.RelativePath, payload.BackupId, deviceId);
            }
            else
            {
                logger.LogError("Restore command {CommandId} failed for device {DeviceId}: {ErrorMessage}", commandId, deviceId, errorMessage);
            }
        }
    }

    private static async Task<bool> MatchesBackupAsync(
        string path,
        long expectedSize,
        string expectedSha256,
        CancellationToken cancellationToken)
    {
        var fileInfo = new FileInfo(path);
        if (fileInfo.Length != expectedSize) return false;
        await using var stream = File.OpenRead(path);
        var actualHash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken));
        return actualHash.Equals(expectedSha256, StringComparison.OrdinalIgnoreCase);
    }

    private static string GetSafeDestination(string drive, string relativePath)
    {
        if (!Regex.IsMatch(drive, "^[a-z]$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant) ||
            Path.IsPathRooted(relativePath) ||
            relativePath.Contains(':') ||
            relativePath.Split(['\\', '/'], StringSplitOptions.None)
                .Any(segment => string.IsNullOrWhiteSpace(segment) || segment is "." or ".."))
        {
            throw new InvalidDataException("Restore command contains an unsafe destination path.");
        }

        var root = Path.GetFullPath($"{drive}:\\");
        var destination = Path.GetFullPath(Path.Combine(root, relativePath.Replace('/', Path.DirectorySeparatorChar)));
        if (!destination.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Restore destination escapes its source drive.");
        return destination;
    }
}
