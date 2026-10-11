using System.Text.Json;
using System.Security.Cryptography;
using LanVault.Agent.Models;

namespace LanVault.Agent.Services;

public sealed class BackupExecutor(
    AgentApiClient apiClient,
    UsnStateStore usnStore,
    VssSnapshotService vss,
    ILogger<BackupExecutor> logger)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    private const long ChunkThresholdBytes = 16L * 1024 * 1024;
    private const int ChunkSizeBytes = 2 * 1024 * 1024;
    private static readonly TimeSpan FullScanInterval = TimeSpan.FromDays(7);

    private sealed record Candidate(
        string Source,
        string ReadPath,
        string Drive,
        string Relative,
        long Length,
        long Ticks,
        string Sha256);

    private sealed record DeletedEntry(string DriveLetter, string RelativePath);

    private sealed record ScanOutcome(
        List<Candidate> Candidates,
        List<DeletedEntry> Deleted,
        List<FileManifestEntry> Entries,
        int Warnings);

    public async Task<BackupExecutionResult> ExecuteAsync(
        BackupExecutionRequest request,
        string token,
        double? maxTransferRateMbps,
        Func<BackupProgressRequest, Task> report,
        CancellationToken cancellationToken)
    {
        var started = DateTimeOffset.UtcNow;
        await report(new BackupProgressRequest
        {
            Status = "running",
            ProgressPercent = 0,
            BytesProcessed = 0,
            StartedAt = started,
        });

        var manifestDirectory = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "LanVault", "Agent", "Manifests", Sanitize(request.DeviceId));
        Directory.CreateDirectory(manifestDirectory);
        var manifestPath = Path.Combine(manifestDirectory, $"{request.DestinationSlot}.json");
        var previous = await LoadManifestAsync(manifestPath, cancellationToken);
        var previousFiles = previous.Files.ToDictionary(item => item.SourcePath, StringComparer.OrdinalIgnoreCase);
        var usnState = usnStore.Load(request.DeviceId);
        var excludedExtensions = request.ExcludedExtensions
            .Select(extension => extension.Trim().ToLowerInvariant())
            .Where(extension => extension.Length > 1 && extension[0] == '.')
            .ToHashSet(StringComparer.Ordinal);

        // Resolve selected roots; a missing disk marks the inventory incomplete.
        var roots = new List<string>();
        var inventoryComplete = true;
        var warnings = 0;
        foreach (var disk in request.Disks.Distinct(StringComparer.OrdinalIgnoreCase))
        {
            cancellationToken.ThrowIfCancellationRequested();
            var root = Path.GetFullPath(disk.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar) + Path.DirectorySeparatorChar);
            if (string.IsNullOrWhiteSpace(root) || !Directory.Exists(root))
            {
                warnings++;
                inventoryComplete = false;
                logger.LogWarning("Selected disk {Disk} is not available.", disk);
                continue;
            }
            roots.Add(root);
        }

        // VSS snapshots let us read locked/open files consistently.
        var snapshots = await vss.CreateSnapshotsAsync(
            roots.Select(GetDriveLetter).Where(letter => letter is not null).Cast<string>(),
            cancellationToken);
        string MapReadPath(string source) => vss.MapPath(snapshots, source);

        var candidates = new List<Candidate>();
        var deleted = new List<DeletedEntry>();
        var inventoryMode = "full";
        var manifestEntries = new List<FileManifestEntry>();
        try
        {
            var wantFullScan = request.Mode.Equals("full", StringComparison.OrdinalIgnoreCase)
                || previousFiles.Count == 0
                || usnState.LastFullScanUtc is null
                || DateTimeOffset.UtcNow - usnState.LastFullScanUtc > FullScanInterval
                || !roots.All(root => usnState.Drives.ContainsKey(GetDriveLetter(root) ?? string.Empty));

            if (wantFullScan)
            {
                var outcome = await FullScanAsync(
                    roots, previousFiles, excludedExtensions, usnState, MapReadPath, cancellationToken);
                candidates = outcome.Candidates;
                deleted = outcome.Deleted;
                manifestEntries = outcome.Entries;
                warnings += outcome.Warnings;
                inventoryMode = "full";
            }
            else
            {
                var delta = await UsnScanAsync(
                    roots, previousFiles, excludedExtensions, usnState, MapReadPath, cancellationToken);
                if (delta is null)
                {
                    logger.LogInformation("USN journal unavailable; falling back to a smart full scan.");
                    var outcome = await FullScanAsync(
                        roots, previousFiles, excludedExtensions, usnState, MapReadPath, cancellationToken);
                    candidates = outcome.Candidates;
                    deleted = outcome.Deleted;
                    manifestEntries = outcome.Entries;
                    warnings += outcome.Warnings;
                    inventoryMode = "full";
                }
                else
                {
                    candidates = delta.Candidates;
                    deleted = delta.Deleted;
                    manifestEntries = delta.Entries;
                    warnings += delta.Warnings;
                    inventoryMode = "delta";
                }
            }

            // Safety net: never report mass deletions from a partial view.
            if (!inventoryComplete) deleted.Clear();
            else if (previousFiles.Count > 0 && deleted.Count > previousFiles.Count / 2)
            {
                logger.LogWarning("Deletion set looks implausible ({Count} of {Total}); forcing a full scan.", deleted.Count, previousFiles.Count);
                var outcome = await FullScanAsync(
                    roots, previousFiles, excludedExtensions, usnState, MapReadPath, cancellationToken);
                candidates = outcome.Candidates;
                deleted = outcome.Deleted;
                manifestEntries = outcome.Entries;
                warnings += outcome.Warnings;
                inventoryMode = "full";
                if (!inventoryComplete) deleted.Clear();
            }
            // Excluded types are never backup content: never report them as deleted.
            if (deleted.Count > 0)
                deleted.RemoveAll(entry => excludedExtensions.Any(extension => entry.RelativePath.EndsWith(extension, StringComparison.OrdinalIgnoreCase)));

            var totalBytes = candidates.Sum(file => file.Length);
            long copied = 0;
            var lastReportedPercent = 0;
            var lastReportAt = DateTimeOffset.UtcNow;
            await report(new BackupProgressRequest { Status = "running", ProgressPercent = 0, BytesProcessed = 0, TotalBytes = totalBytes, StartedAt = started });

            int GetProgressPercent(long bytesProcessed)
                => totalBytes == 0 ? 100 : (int)Math.Clamp(Math.Round(bytesProcessed * 100d / totalBytes), 0, 100);

            async Task ReportProgressIfNeededAsync(long bytesProcessed, bool force = false)
            {
                var percent = GetProgressPercent(bytesProcessed);
                var now = DateTimeOffset.UtcNow;
                if (!force && percent == lastReportedPercent && now - lastReportAt < TimeSpan.FromSeconds(1)) return;
                await report(new BackupProgressRequest
                {
                    Status = "running",
                    ProgressPercent = percent,
                    BytesProcessed = bytesProcessed,
                    TotalBytes = totalBytes,
                    StartedAt = started,
                });
                lastReportedPercent = percent;
                lastReportAt = now;
            }

            foreach (var file in candidates)
            {
                cancellationToken.ThrowIfCancellationRequested();
                try
                {
                    var driveDirectory = GetDriveFolder(file.Drive);
                    var includedByClone = await apiClient.CloneBackupFileAsync(
                        request.DeviceId,
                        request.BackupId,
                        driveDirectory,
                        file.Relative,
                        request.DestinationSlot,
                        file.Length,
                        file.Ticks,
                        file.Sha256,
                        token,
                        cancellationToken);
                    if (!includedByClone)
                    {
                        if (file.Length >= ChunkThresholdBytes)
                        {
                            await UploadChunkedAsync(
                                request, token, driveDirectory, file,
                                async bytesTransferred => { await ReportProgressIfNeededAsync(copied + bytesTransferred); },
                                cancellationToken);
                        }
                        else
                        {
                            await apiClient.UploadBackupFileAsync(
                                request.DeviceId,
                                request.BackupId,
                                driveDirectory,
                                file.Relative,
                                request.DestinationSlot,
                                file.Length,
                                file.Ticks,
                                file.Sha256,
                                file.ReadPath,
                                maxTransferRateMbps,
                                token,
                                async bytesTransferred =>
                                {
                                    await ReportProgressIfNeededAsync(copied + bytesTransferred);
                                },
                                cancellationToken);
                        }
                    }
                    copied += file.Length;
                    await ReportProgressIfNeededAsync(copied);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    await ReportProgressIfNeededAsync(copied, force: true);
                    warnings++;
                    logger.LogWarning(exception, "Could not copy {SourcePath}.", file.Source);
                    var message = $"Could not copy {file.Drive}:\\{file.Relative}: {exception.Message}";
                    await apiClient.ReportBackupLogAsync(
                        request.DeviceId,
                        request.BackupId,
                        token,
                        "warning",
                        message.Length > 2000 ? message[..2000] : message,
                        cancellationToken);
                }
            }

            if (deleted.Count > 0 && inventoryComplete)
            {
                try
                {
                    await apiClient.ReportDeletedPathsAsync(
                        request.DeviceId,
                        request.BackupId,
                        token,
                        deleted.Select(entry => (entry.DriveLetter, entry.RelativePath)).ToList(),
                        cancellationToken);
                }
                catch (Exception exception)
                {
                    warnings++;
                    logger.LogWarning(exception, "Could not report deleted paths for backup {BackupId}.", request.BackupId);
                }
            }

            var manifest = new FileManifest { CreatedAt = DateTimeOffset.UtcNow, BackupId = request.BackupId, Files = manifestEntries };
            var temporaryManifestPath = $"{manifestPath}.{Guid.NewGuid():N}.tmp";
            await File.WriteAllTextAsync(temporaryManifestPath, JsonSerializer.Serialize(manifest, JsonOptions), cancellationToken);
            File.Move(temporaryManifestPath, manifestPath, overwrite: true);
            usnStore.Save(request.DeviceId, usnState);
            return new BackupExecutionResult
            {
                CopiedBytes = copied,
                TotalBytes = totalBytes,
                WarningCount = warnings,
                InventoryComplete = inventoryComplete,
                InventoryMode = inventoryMode,
            };
        }
        finally
        {
            await vss.DeleteSnapshotsAsync(snapshots, CancellationToken.None);
        }
    }

    /// <summary>
    /// Smart full scan: enumerate everything but hash only files whose
    /// size or timestamp differs from the manifest.
    /// </summary>
    private async Task<ScanOutcome> FullScanAsync(
        List<string> roots,
        Dictionary<string, FileManifestEntry> previousFiles,
        HashSet<string> excludedExtensions,
        UsnDeviceState usnState,
        Func<string, string> mapReadPath,
        CancellationToken cancellationToken)
    {
        var candidates = new List<Candidate>();
        var entries = new List<FileManifestEntry>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var directories = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var warnings = 0;

        foreach (var root in roots)
        {
            foreach (var file in EnumerateFiles(root, cancellationToken, () => warnings++))
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (excludedExtensions.Any(extension => file.EndsWith(extension, StringComparison.OrdinalIgnoreCase))) continue;
                FileInfo info;
                try
                {
                    info = new FileInfo(file);
                    if (!info.Exists) continue;
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    warnings++;
                    continue;
                }
                seen.Add(file);
                var parent = Path.GetDirectoryName(file);
                if (parent is not null) directories.Add(parent);
                var relative = Path.GetRelativePath(root, file);
                var ticks = info.LastWriteTimeUtc.Ticks;
                var length = info.Length;
                var readPath = mapReadPath(file);
                string sha256;
                if (previousFiles.TryGetValue(file, out var previousFile)
                    && previousFile.Length == length
                    && previousFile.LastWriteTimeUtcTicks == ticks
                    && !string.IsNullOrWhiteSpace(previousFile.Sha256))
                {
                    // Unchanged by size+time: skip the expensive hash entirely.
                    sha256 = previousFile.Sha256;
                }
                else
                {
                    try
                    {
                        sha256 = await HashFileAsync(readPath, cancellationToken);
                    }
                    catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                    {
                        warnings++;
                        logger.LogWarning(exception, "Could not inspect {SourcePath}.", file);
                        continue;
                    }
                    var changed = !previousFiles.TryGetValue(file, out var prior)
                        || prior.Length != length || prior.LastWriteTimeUtcTicks != ticks
                        || !string.Equals(prior.Sha256, sha256, StringComparison.OrdinalIgnoreCase);
                    if (changed)
                        candidates.Add(new Candidate(file, readPath, root, relative, length, ticks, sha256));
                }
                entries.Add(new FileManifestEntry
                {
                    SourcePath = file,
                    DriveId = root,
                    RelativePath = relative,
                    Length = length,
                    LastWriteTimeUtcTicks = ticks,
                    Sha256 = sha256,
                });
            }
        }

        var deleted = previousFiles.Keys
            .Where(old => !seen.Contains(old))
            .Select(old => ToDeletedEntry(old))
            .Where(entry => entry is not null)
            .Cast<DeletedEntry>()
            .ToList();

        // Refresh directory FRN map + journal baselines for future USN runs.
        var frns = new Dictionary<ulong, string>();
        foreach (var directory in directories)
        {
            if (UsnJournalReader.TryGetDirectoryFrn(directory, out var frn))
                frns[frn] = directory;
        }
        usnState.DirectoryFrns = frns;
        foreach (var root in roots)
        {
            var letter = GetDriveLetter(root);
            if (letter is null) continue;
            var journal = QueryJournalState(letter);
            if (journal is not null) usnState.Drives[letter] = journal;
        }
        usnState.LastFullScanUtc = DateTimeOffset.UtcNow;
        return new ScanOutcome(candidates, deleted, entries, warnings);
    }

    /// <summary>
    /// USN fast path: only stat/hash files the NTFS journal reports as changed.
    /// Returns null when a full scan fallback is required.
    /// </summary>
    private async Task<ScanOutcome?> UsnScanAsync(
        List<string> roots,
        Dictionary<string, FileManifestEntry> previousFiles,
        HashSet<string> excludedExtensions,
        UsnDeviceState usnState,
        Func<string, string> mapReadPath,
        CancellationToken cancellationToken)
    {
        var candidates = new List<Candidate>();
        var deleted = new List<DeletedEntry>();
        // Start from the previous manifest; apply deltas in place.
        var entries = previousFiles.Values.ToList();

        foreach (var root in roots)
        {
            var letter = GetDriveLetter(root);
            if (letter is null) return null;
            if (!usnState.Drives.TryGetValue(letter, out var driveState)) return null;
            var changes = UsnJournalReader.TryReadChanges(
                letter, driveState.JournalId, driveState.NextUsn, true,
                usnState.DirectoryFrns, new[] { root }, out _);
            if (changes is null) return null;
            usnState.Drives[letter] = new UsnDriveState { JournalId = changes.JournalId, NextUsn = changes.NextUsn };

            foreach (var change in changes.Changes)
            {
                cancellationToken.ThrowIfCancellationRequested();
                if (excludedExtensions.Any(extension => change.FullPath.EndsWith(extension, StringComparison.OrdinalIgnoreCase))) continue;
                FileInfo info;
                try
                {
                    info = new FileInfo(change.FullPath);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    continue;
                }
                if (!info.Exists || (info.Attributes & FileAttributes.Directory) != 0)
                {
                    // Missing on disk: deleted only if its parent folder still exists
                    // (a missing parent means rename/move — handled by full scan).
                    var parent = Path.GetDirectoryName(change.FullPath);
                    if (parent is not null && !Directory.Exists(parent)) return null;
                    var gone = ToDeletedEntry(change.FullPath);
                    if (gone is not null && previousFiles.ContainsKey(change.FullPath))
                    {
                        deleted.Add(gone);
                        entries.RemoveAll(entry => entry.SourcePath.Equals(change.FullPath, StringComparison.OrdinalIgnoreCase));
                    }
                    continue;
                }
                var relative = Path.GetRelativePath(root, change.FullPath);
                var ticks = info.LastWriteTimeUtc.Ticks;
                var length = info.Length;
                if (previousFiles.TryGetValue(change.FullPath, out var prior)
                    && prior.Length == length && prior.LastWriteTimeUtcTicks == ticks
                    && !string.IsNullOrWhiteSpace(prior.Sha256))
                {
                    continue;
                }
                string sha256;
                try
                {
                    sha256 = await HashFileAsync(mapReadPath(change.FullPath), cancellationToken);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    logger.LogWarning(exception, "Could not inspect {SourcePath}.", change.FullPath);
                    continue;
                }
                candidates.Add(new Candidate(change.FullPath, mapReadPath(change.FullPath), root, relative, length, ticks, sha256));
                entries.RemoveAll(entry => entry.SourcePath.Equals(change.FullPath, StringComparison.OrdinalIgnoreCase));
                entries.Add(new FileManifestEntry
                {
                    SourcePath = change.FullPath,
                    DriveId = root,
                    RelativePath = relative,
                    Length = length,
                    LastWriteTimeUtcTicks = ticks,
                    Sha256 = sha256,
                });
            }
        }
        return new ScanOutcome(candidates, deleted, entries, 0);
    }

    private async Task UploadChunkedAsync(
        BackupExecutionRequest request,
        string token,
        string driveDirectory,
        Candidate file,
        Func<long, Task> reportBytes,
        CancellationToken cancellationToken)
    {
        var chunkShas = await HashChunksAsync(file.ReadPath, ChunkSizeBytes, cancellationToken);
        var missing = await apiClient.QueryMissingChunksAsync(
            request.DeviceId, request.BackupId, driveDirectory, file.Relative,
            request.DestinationSlot, file.Length, ChunkSizeBytes, chunkShas, token, cancellationToken);
        long uploaded = 0;
        foreach (var index in missing)
        {
            cancellationToken.ThrowIfCancellationRequested();
            var offset = (long)index * ChunkSizeBytes;
            var length = (int)Math.Min(ChunkSizeBytes, file.Length - offset);
            await apiClient.UploadChunkAsync(
                request.DeviceId, request.BackupId, driveDirectory, file.Relative,
                request.DestinationSlot, index, chunkShas[index], file.ReadPath,
                offset, length, token,
                async sent => { await reportBytes(uploaded + sent); },
                cancellationToken);
            uploaded += length;
            await reportBytes(uploaded);
        }
        await apiClient.AssembleChunksAsync(
            request.DeviceId, request.BackupId, driveDirectory, file.Relative,
            request.DestinationSlot, file.Length, file.Ticks, file.Sha256,
            ChunkSizeBytes, chunkShas, token, cancellationToken);
    }

    private static async Task<string> HashFileAsync(string path, CancellationToken cancellationToken)
    {
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete, 1024 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        return Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken));
    }

    private static async Task<List<string>> HashChunksAsync(string path, int chunkSize, CancellationToken cancellationToken)
    {
        var hashes = new List<string>();
        await using var stream = new FileStream(path, FileMode.Open, FileAccess.Read,
            FileShare.ReadWrite | FileShare.Delete, 1024 * 1024,
            FileOptions.Asynchronous | FileOptions.SequentialScan);
        var buffer = new byte[chunkSize];
        while (true)
        {
            var read = 0;
            while (read < chunkSize)
            {
                var n = await stream.ReadAsync(buffer.AsMemory(read, chunkSize - read), cancellationToken);
                if (n == 0) break;
                read += n;
            }
            if (read == 0) break;
            hashes.Add(Convert.ToHexString(SHA256.HashData(buffer.AsSpan(0, read))));
        }
        return hashes;
    }

    private static bool TryGetJournalPosition(string driveLetter, out ulong journalId, out long nextUsn)
        => UsnJournalReader.TryGetJournalState(driveLetter, out journalId, out nextUsn);

    private static UsnDriveState? QueryJournalState(string driveLetter)
    {
        if (!TryGetJournalPosition(driveLetter, out var journalId, out var nextUsn)) return null;
        return new UsnDriveState { JournalId = journalId, NextUsn = nextUsn };
    }

    private static DeletedEntry? ToDeletedEntry(string fullPath)
    {
        var root = Path.GetPathRoot(fullPath);
        if (string.IsNullOrWhiteSpace(root)) return null;
        var letter = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).TrimEnd(':');
        if (letter.Length != 1) return null;
        string relative;
        try { relative = Path.GetRelativePath(root, fullPath); }
        catch { return null; }
        if (relative == "." || relative.StartsWith("..", StringComparison.Ordinal)) return null;
        return new DeletedEntry(letter.ToUpperInvariant(), relative);
    }

    private static string? GetDriveLetter(string root)
    {
        var trimmed = root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).TrimEnd(':');
        return trimmed.Length == 1 ? trimmed.ToUpperInvariant() : null;
    }

    private static async Task<FileManifest> LoadManifestAsync(string path, CancellationToken cancellationToken)
    {
        if (!File.Exists(path)) return new FileManifest();
        try
        {
            var content = await File.ReadAllTextAsync(path, cancellationToken);
            return JsonSerializer.Deserialize<FileManifest>(content, JsonOptions) ?? new FileManifest();
        }
        catch (JsonException) { return new FileManifest(); }
        catch (IOException) { return new FileManifest(); }
    }

    private static IEnumerable<string> EnumerateFiles(string root, CancellationToken cancellationToken, Action warning)
    {
        var pending = new Stack<string>();
        pending.Push(root);
        while (pending.TryPop(out var directory))
        {
            cancellationToken.ThrowIfCancellationRequested();
            string[] files;
            try { files = Directory.GetFiles(directory); }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { warning(); continue; }
            foreach (var file in files) yield return file;
            string[] subdirectories;
            try { subdirectories = Directory.GetDirectories(directory); }
            catch (Exception exception) when (exception is IOException or UnauthorizedAccessException) { warning(); continue; }
            foreach (var child in subdirectories)
            {
                try
                {
                    if ((File.GetAttributes(child) & FileAttributes.ReparsePoint) == 0) pending.Push(child);
                }
                catch (Exception exception) when (exception is IOException or UnauthorizedAccessException)
                {
                    warning();
                }
            }
        }
    }

    private static string Sanitize(string value)
    {
        var invalid = Path.GetInvalidFileNameChars();
        return string.Concat(value.Select(character => invalid.Contains(character) ? '_' : character));
    }

    private static string GetDriveFolder(string driveId)
    {
        var root = Path.GetPathRoot(driveId)?.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar).TrimEnd(':');
        return Sanitize(string.IsNullOrWhiteSpace(root) ? driveId : root);
    }
}
