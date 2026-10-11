using System.Text.Json;
using System.Text.Json.Serialization;

namespace LanVault.Agent.Models;

public sealed class DeviceRegistrationRequest
{
    public string? AgentToken { get; init; }
    public required string ComputerName { get; init; }
    public required string WindowsUsername { get; init; }
    public string? IpAddress { get; init; }
    public string? MacAddress { get; init; }
    public required string OperatingSystem { get; init; }
    public required string AgentVersion { get; init; }
    public required IReadOnlyList<DiskSnapshot> Disks { get; init; }
}

public sealed class DiskSnapshot
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public string? Letter { get; init; }
    public string? FileSystem { get; init; }
    public long TotalBytes { get; init; }
    public long FreeBytes { get; init; }
}

public sealed class DeviceRegistrationResponse
{
    public DeviceReference? Device { get; init; }
    public string? AgentToken { get; init; }
    public int? PollingIntervalSeconds { get; init; }
}

public sealed class DeviceReference
{
    public string? Id { get; init; }
}

public sealed class HeartbeatRequest
{
    public required string Status { get; init; }
    public string? AgentVersion { get; init; }
    public string? AgentBuildHash { get; init; }
    public string? IpAddress { get; init; }
    public IReadOnlyList<DiskSnapshot>? Disks { get; init; }
    public string? ErrorMessage { get; init; }
}

public sealed class HeartbeatResponse
{
    public IReadOnlyList<AgentCommand> Commands { get; init; } = Array.Empty<AgentCommand>();
}

public sealed class AgentCommand
{
    public string? Id { get; init; }
    public string? Type { get; init; }
    public JsonElement Payload { get; init; }
}

public sealed class BackupCommandPayload
{
    public string? BackupId { get; init; }
    public string? Mode { get; init; }
    public string? Destination { get; init; }
    public string? SecondaryDestination { get; init; }
    public IReadOnlyList<string>? Disks { get; init; }
    public IReadOnlyList<string>? ExcludedExtensions { get; init; }
    public double? MaxTransferRateMbps { get; init; }
    public int? RetentionCount { get; init; }
}

public sealed class CancelBackupCommandPayload
{
    public string? BackupId { get; init; }
}

public sealed class RestoreFileCommandPayload
{
    public string? DeletedFileId { get; init; }
    public string? BackupId { get; init; }
    public string? Drive { get; init; }
    public string? RelativePath { get; init; }
    public long? SizeBytes { get; init; }
    public string? Sha256 { get; init; }
}

public sealed class UpdateAgentCommandPayload
{
    public string? BuildHash { get; init; }
    public string? Version { get; init; }
}

public sealed class BackupProgressRequest
{
    public required string Status { get; init; }
    public int ProgressPercent { get; init; }
    public long? BytesProcessed { get; init; }
    public long? TotalBytes { get; init; }
    public string? ErrorMessage { get; init; }
    public DateTimeOffset? StartedAt { get; init; }
    public DateTimeOffset? CompletedAt { get; init; }
    public long? BackupSizeBytes { get; init; }
    public int? RetentionCount { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public bool? InventoryComplete { get; init; }
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? InventoryMode { get; init; }
}

public sealed class AgentLogRequest
{
    public required string Level { get; init; }
    public required string Message { get; init; }
}

public sealed class AgentIdentityState
{
    public string? DeviceId { get; set; }
    public string? AgentToken { get; set; }
    public string? MacAddress { get; set; }
    public DateTimeOffset? RegisteredAt { get; set; }
    public List<string> ProcessedCommandIds { get; set; } = new();
}

public sealed class FileManifest
{
    public const int CurrentVersion = 1;

    public int Version { get; init; } = CurrentVersion;
    public DateTimeOffset CreatedAt { get; init; }
    public string? BackupDirectory { get; init; }
    public string? BackupId { get; init; }
    public List<FileManifestEntry> Files { get; init; } = new();
}

public sealed class FileManifestEntry
{
    public required string SourcePath { get; init; }
    public required string DriveId { get; init; }
    public required string RelativePath { get; init; }
    public long Length { get; init; }
    public long LastWriteTimeUtcTicks { get; init; }
    public string? Sha256 { get; init; }
}

public sealed class BackupExecutionRequest
{
    public required string BackupId { get; init; }
    public required string DeviceId { get; init; }
    public required string DestinationSlot { get; init; }
    public required string Mode { get; init; }
    public required string Destination { get; init; }
    public string? SecondaryDestination { get; init; }
    public required IReadOnlyList<string> Disks { get; init; }
    public IReadOnlyList<string> ExcludedExtensions { get; init; } = Array.Empty<string>();
    public double? MaxTransferRateMbps { get; init; }
}

public sealed class BackupExecutionResult
{
    public required long CopiedBytes { get; init; }
    public required long TotalBytes { get; init; }
    public required int WarningCount { get; init; }
    public bool InventoryComplete { get; init; } = true;
    public string InventoryMode { get; init; } = "full";
}

[JsonSerializable(typeof(BackupCommandPayload))]
[JsonSerializable(typeof(CancelBackupCommandPayload))]
[JsonSerializable(typeof(RestoreFileCommandPayload))]
internal partial class AgentJsonContext : JsonSerializerContext;
