using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;
using LanVault.Agent.Configuration;
using LanVault.Agent.Models;
using Microsoft.Extensions.Options;

namespace LanVault.Agent.Services;

public sealed class AgentIdentityStore
{
    private readonly string _statePath;
    private readonly string _installerStatusPath;
    private readonly ILogger<AgentIdentityStore> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public AgentIdentityStore(IOptions<AgentOptions> options, ILogger<AgentIdentityStore> logger)
    {
        _logger = logger;
        var directory = string.IsNullOrWhiteSpace(options.Value.StateDirectory)
            ? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "LanVault", "Agent")
            : options.Value.StateDirectory;
        Directory.CreateDirectory(directory);
        _statePath = Path.Combine(directory, "identity.dpapi");
        _installerStatusPath = Path.Combine(directory, "installer-status.json");
    }

    public void WriteInstallerStatus(string status, string? message = null, string? deviceId = null)
    {
        var temporaryPath = $"{_installerStatusPath}.{Guid.NewGuid():N}.tmp";
        try
        {
            var payload = JsonSerializer.Serialize(new
            {
                status,
                message,
                deviceId,
                updatedAt = DateTimeOffset.UtcNow,
            }, JsonOptions);
            File.WriteAllText(temporaryPath, payload);
            File.Move(temporaryPath, _installerStatusPath, overwrite: true);
        }
        catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
        {
            _logger.LogWarning(exception, "Could not update installer status file.");
            try
            {
                if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            }
            catch (Exception cleanupException) when (cleanupException is IOException or UnauthorizedAccessException)
            {
                _logger.LogDebug(cleanupException, "Could not remove temporary installer status file.");
            }
        }
    }

    public AgentIdentityState Load()
    {
        if (!File.Exists(_statePath)) return new AgentIdentityState();
        try
        {
            var protectedBytes = File.ReadAllBytes(_statePath);
            var plainBytes = Dpapi.Unprotect(protectedBytes);
            try { return JsonSerializer.Deserialize<AgentIdentityState>(plainBytes, JsonOptions) ?? new AgentIdentityState(); }
            finally { CryptographicOperations.ZeroMemory(plainBytes); }
        }
        catch (Exception exception) when (exception is IOException or CryptographicException or JsonException or Win32Exception)
        {
            _logger.LogError(exception, "Could not read protected agent identity.");
            throw new InvalidOperationException("The protected LanVault agent identity could not be read.", exception);
        }
    }

    public void Save(AgentIdentityState state)
    {
        var plainBytes = JsonSerializer.SerializeToUtf8Bytes(state, JsonOptions);
        var protectedBytes = Dpapi.Protect(plainBytes);
        var temporaryPath = $"{_statePath}.{Guid.NewGuid():N}.tmp";
        try
        {
            File.WriteAllBytes(temporaryPath, protectedBytes);
            File.Move(temporaryPath, _statePath, overwrite: true);
        }
        finally
        {
            if (File.Exists(temporaryPath)) File.Delete(temporaryPath);
            CryptographicOperations.ZeroMemory(plainBytes);
        }
    }

    private static class Dpapi
    {
        public static byte[] Protect(byte[] input) => Transform(input, protect: true);
        public static byte[] Unprotect(byte[] input) => Transform(input, protect: false);

        private static byte[] Transform(byte[] input, bool protect)
        {
            var inputHandle = GCHandle.Alloc(input, GCHandleType.Pinned);
            try
            {
                var inputBlob = new DataBlob { Length = input.Length, Data = inputHandle.AddrOfPinnedObject() };
                DataBlob outputBlob;
                var success = protect
                    ? CryptProtectData(ref inputBlob, "LanVault Agent identity", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out outputBlob)
                    : CryptUnprotectData(ref inputBlob, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, 0, out outputBlob);
                if (!success) throw new Win32Exception(Marshal.GetLastWin32Error());
                try
                {
                    var output = new byte[outputBlob.Length];
                    Marshal.Copy(outputBlob.Data, output, 0, outputBlob.Length);
                    return output;
                }
                finally { _ = LocalFree(outputBlob.Data); }
            }
            finally { inputHandle.Free(); }
        }

        [StructLayout(LayoutKind.Sequential)]
        private struct DataBlob { public int Length; public IntPtr Data; }

        [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CryptProtectData(ref DataBlob input, string description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);

        [DllImport("crypt32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool CryptUnprotectData(ref DataBlob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out DataBlob output);

        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr memory);
    }
}
