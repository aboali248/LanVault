using System.Text.Json;

namespace LanVault.Agent.Services;

public sealed class UsnDriveState
{
    public ulong JournalId { get; set; }
    public long NextUsn { get; set; }
}

public sealed class UsnDeviceState
{
    public Dictionary<string, UsnDriveState> Drives { get; set; } = new(StringComparer.OrdinalIgnoreCase);
    public Dictionary<ulong, string> DirectoryFrns { get; set; } = new();
    public DateTimeOffset? LastFullScanUtc { get; set; }
}

/// <summary>
/// Persists USN journal positions and directory FRN maps per device (slot independent).
/// </summary>
public sealed class UsnStateStore(ILogger<UsnStateStore> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static string StatePathFor(string deviceId)
    {
        var invalid = Path.GetInvalidFileNameChars();
        var safe = string.Concat(deviceId.Select(character => invalid.Contains(character) ? '_' : character));
        var directory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "LanVault", "Agent", "Manifests", safe);
        Directory.CreateDirectory(directory);
        return Path.Combine(directory, "usn.json");
    }

    public UsnDeviceState Load(string deviceId)
    {
        var path = StatePathFor(deviceId);
        if (!File.Exists(path)) return new UsnDeviceState();
        try
        {
            var content = File.ReadAllText(path);
            return JsonSerializer.Deserialize<UsnDeviceState>(content, JsonOptions) ?? new UsnDeviceState();
        }
        catch (Exception exception) when (exception is IOException or JsonException or UnauthorizedAccessException)
        {
            logger.LogWarning(exception, "Could not load USN state; a full scan will be used.");
            return new UsnDeviceState();
        }
    }

    public void Save(string deviceId, UsnDeviceState state)
    {
        var path = StatePathFor(deviceId);
        try
        {
            var temporary = $"{path}.{Guid.NewGuid():N}.tmp";
            File.WriteAllText(temporary, JsonSerializer.Serialize(state, JsonOptions));
            File.Move(temporary, path, overwrite: true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            logger.LogWarning(exception, "Could not persist USN state.");
        }
    }
}
