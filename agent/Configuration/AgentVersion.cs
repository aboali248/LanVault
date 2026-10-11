using System.Reflection;
using System.Security.Cryptography;

namespace LanVault.Agent.Configuration;

public static class AgentVersion
{
    public static readonly string Current =
        typeof(AgentVersion).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion
        ?? typeof(AgentVersion).Assembly.GetName().Version?.ToString()
        ?? "unknown";

    public static readonly string BuildHash = GetBuildHash();

    private static string GetBuildHash()
    {
        var executablePath = Environment.ProcessPath
            ?? throw new InvalidOperationException("Could not determine the LanVault Agent executable path.");
        using var executable = File.OpenRead(executablePath);
        return Convert.ToHexString(SHA256.HashData(executable));
    }
}
