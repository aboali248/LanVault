using System.Collections.Concurrent;

namespace LanVault.Agent.Services;

public sealed class AgentRuntimeState
{
    private readonly ConcurrentDictionary<string, CancellationTokenSource> _runningBackups = new(StringComparer.OrdinalIgnoreCase);

    public bool HasRunningBackups => !_runningBackups.IsEmpty;

    public bool TryStart(string backupId, CancellationTokenSource cancellation)
        => _runningBackups.TryAdd(backupId, cancellation);

    public bool Stop(string backupId)
    {
        if (!_runningBackups.TryGetValue(backupId, out var cancellation)) return false;
        cancellation.Cancel();
        return true;
    }

    public void Complete(string backupId)
    {
        if (_runningBackups.TryRemove(backupId, out var cancellation)) cancellation.Dispose();
    }
}
