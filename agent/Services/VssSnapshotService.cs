using System.Diagnostics;

namespace LanVault.Agent.Services;

public sealed record VssSnapshot(string DriveLetter, string DeviceRoot, string ShadowId);

/// <summary>
/// Creates Volume Shadow Copies via WMI (Win32_ShadowCopy) so locked and open
/// files can be backed up. Pure PowerShell/CIM: no extra dependencies.
/// Every method fails soft — callers fall back to live paths.
/// </summary>
public sealed class VssSnapshotService(ILogger<VssSnapshotService> logger)
{
    private const int CommandTimeoutSeconds = 120;

    public async Task<IReadOnlyList<VssSnapshot>> CreateSnapshotsAsync(
        IEnumerable<string> driveLetters,
        CancellationToken cancellationToken)
    {
        var snapshots = new List<VssSnapshot>();
        foreach (var drive in driveLetters.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var snapshot = await CreateSingleAsync(drive, cancellationToken);
            if (snapshot is not null) snapshots.Add(snapshot);
        }
        return snapshots;
    }

    public string MapPath(IReadOnlyList<VssSnapshot> snapshots, string sourcePath)
    {
        foreach (var snapshot in snapshots)
        {
            var prefix = $"{snapshot.DriveLetter}:\\";
            if (sourcePath.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                return snapshot.DeviceRoot + sourcePath[prefix.Length..];
        }
        return sourcePath;
    }

    public async Task DeleteSnapshotsAsync(
        IEnumerable<VssSnapshot> snapshots,
        CancellationToken cancellationToken)
    {
        foreach (var snapshot in snapshots)
        {
            cancellationToken.ThrowIfCancellationRequested();
            try
            {
                var script = $"Get-CimInstance -ClassName Win32_ShadowCopy -Filter \"ID='{snapshot.ShadowId}'\" | Remove-CimInstance";
                await RunPowerShellAsync(script, cancellationToken);
            }
            catch (Exception exception)
            {
                logger.LogWarning(exception, "Could not delete shadow copy {ShadowId} for drive {Drive}.", snapshot.ShadowId, snapshot.DriveLetter);
            }
        }
    }

    private async Task<VssSnapshot?> CreateSingleAsync(string driveLetter, CancellationToken cancellationToken)
    {
        try
        {
            var script = "$ErrorActionPreference='Stop';"
                + "$r = Invoke-CimMethod -ClassName Win32_ShadowCopy -MethodName Create"
                + $" -Arguments @{{ Volume='{driveLetter}:\\'; Context='ClientAccessible' }};"
                + "'LVRC=' + $r.ReturnValue;"
                + "'LVSID=' + $r.ShadowID;"
                + "if ($r.ReturnValue -eq 0) { $s = Get-CimInstance -ClassName Win32_ShadowCopy"
                + " -Filter (\"ID='\" + $r.ShadowID + \"'\"); 'LVDEV=' + $s.DeviceObject }";
            var output = await RunPowerShellAsync(script, cancellationToken);
            var returnCode = MatchValue(output, "LVRC=");
            var shadowId = MatchValue(output, "LVSID=");
            var device = MatchValue(output, "LVDEV=");
            if (returnCode != "0" || string.IsNullOrWhiteSpace(shadowId) || string.IsNullOrWhiteSpace(device))
            {
                logger.LogWarning("VSS snapshot for drive {Drive} failed (code {Code}); locked files may be skipped.", driveLetter, returnCode ?? "?");
                return null;
            }
            var root = device.TrimEnd('\\') + "\\";
            logger.LogInformation("Created VSS snapshot for drive {Drive}.", driveLetter);
            return new VssSnapshot(driveLetter.ToUpperInvariant(), root, shadowId.Trim());
        }
        catch (Exception exception)
        {
            logger.LogWarning(exception, "VSS snapshot for drive {Drive} is unavailable; locked files may be skipped.", driveLetter);
            return null;
        }
    }

    private static string? MatchValue(string output, string prefix)
    {
        foreach (var line in output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var trimmed = line.Trim();
            if (trimmed.StartsWith(prefix, StringComparison.Ordinal))
                return trimmed[prefix.Length..].Trim();
        }
        return null;
    }

    private static async Task<string> RunPowerShellAsync(string script, CancellationToken cancellationToken)
    {
        using var process = new Process();
        process.StartInfo = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            ArgumentList = { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script },
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        var stdout = new System.Text.StringBuilder();
        var stderr = new System.Text.StringBuilder();
        process.OutputDataReceived += (_, args) => { if (args.Data is not null) stdout.AppendLine(args.Data); };
        process.ErrorDataReceived += (_, args) => { if (args.Data is not null) stderr.AppendLine(args.Data); };
        if (!process.Start()) throw new InvalidOperationException("Could not start powershell.exe.");
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(CommandTimeoutSeconds));
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken, timeout.Token);
        try
        {
            await process.WaitForExitAsync(linked.Token);
        }
        catch (OperationCanceledException) when (timeout.IsCancellationRequested && !cancellationToken.IsCancellationRequested)
        {
            try { process.Kill(entireProcessTree: true); } catch { /* Already exiting. */ }
            throw new TimeoutException("VSS PowerShell command timed out.");
        }
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"powershell.exe exited with code {process.ExitCode}: {stderr}");
        return stdout.ToString();
    }
}
