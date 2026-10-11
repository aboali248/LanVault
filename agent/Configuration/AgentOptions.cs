using System.ComponentModel.DataAnnotations;

namespace LanVault.Agent.Configuration;

public sealed class AgentOptions
{
    public const string SectionName = "LanVaultAgent";

    [Required]
    public ServerOptions Server { get; init; } = new();

    [Range(5, 3600)]
    public int HeartbeatIntervalSeconds { get; set; } = 30;

    [Range(5, 120)]
    public int RequestTimeoutSeconds { get; set; } = 30;

    [Range(1, 16)]
    public int MaxConcurrentBackups { get; set; } = 1;

    /// <summary>
    /// Optional bootstrap token provided at deployment time. Supply it through an environment variable,
    /// never source control. It is sent only during registration and is not written to appsettings.json.
    /// </summary>
    public string? BootstrapToken { get; set; }

    /// <summary>Optional override for encrypted registration state.</summary>
    public string? StateDirectory { get; set; }

    public void ApplyFriendlyEnvironmentOverrides()
    {
        // These names are concise for Windows Service configuration. The normal .NET configuration keys
        // (LANVAULT_AGENT_LanVaultAgent__...) remain supported too.
        Server.BaseUrl = ReadString("LANVAULT_AGENT_SERVER_URL", Server.BaseUrl) ?? Server.BaseUrl;
        BootstrapToken = ReadString("LANVAULT_AGENT_BOOTSTRAP_TOKEN", BootstrapToken);
        StateDirectory = ReadString("LANVAULT_AGENT_STATE_DIRECTORY", StateDirectory);
        HeartbeatIntervalSeconds = ReadInt("LANVAULT_AGENT_HEARTBEAT_SECONDS", HeartbeatIntervalSeconds);
        RequestTimeoutSeconds = ReadInt("LANVAULT_AGENT_REQUEST_TIMEOUT_SECONDS", RequestTimeoutSeconds);
        MaxConcurrentBackups = ReadInt("LANVAULT_AGENT_MAX_CONCURRENT_BACKUPS", MaxConcurrentBackups);
    }

    public bool IsValid(out string? error)
    {
        if (string.IsNullOrWhiteSpace(Server.BaseUrl) ||
            Server.BaseUrl.Any(char.IsWhiteSpace) ||
            !Uri.TryCreate(Server.BaseUrl, UriKind.Absolute, out var serverUri) ||
            (serverUri.Scheme != Uri.UriSchemeHttp && serverUri.Scheme != Uri.UriSchemeHttps))
        {
            error = "LanVaultAgent:Server:BaseUrl must be an absolute http(s) URI without whitespace. Check the Windows service Environment values are stored separately.";
            return false;
        }

        if (HeartbeatIntervalSeconds is < 5 or > 3600 ||
            RequestTimeoutSeconds is < 5 or > 120 ||
            MaxConcurrentBackups is < 1 or > 16)
        {
            error = "Agent interval, timeout, or concurrency is outside its supported range.";
            return false;
        }

        error = null;
        return true;
    }

    private static string? ReadString(string name, string? fallback)
    {
        var value = Environment.GetEnvironmentVariable(name);
        return string.IsNullOrWhiteSpace(value) ? fallback : value.Trim();
    }

    private static int ReadInt(string name, int fallback)
        => int.TryParse(Environment.GetEnvironmentVariable(name), out var value) ? value : fallback;
}

public sealed class ServerOptions
{
    [Required]
    public string BaseUrl { get; set; } = "http://localhost:3031/api/v1/";
}
