using System.Buffers.Binary;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace LanVault.Agent.Services;

/// <summary>
/// A file reported by the NTFS change journal.
/// </summary>
public sealed record UsnChange(string FullPath, bool Deleted);

/// <summary>
/// Reads the NTFS USN change journal so incremental runs only touch changed files.
/// Falls back to a full scan whenever the journal is missing, recreated, or wrapped.
/// </summary>
public static class UsnJournalReader
{
    private const uint FileDeviceFileSystem = 9u;
    private const uint MethodBuffered = 0u;
    private const uint MethodNeither = 3u;
    private const uint FileAnyAccess = 0u;
    private const uint FSCTL_QUERY_USN_JOURNAL = (FileDeviceFileSystem << 16) | (FileAnyAccess << 14) | (30u << 2) | MethodBuffered;
    private const uint FSCTL_CREATE_USN_JOURNAL = (FileDeviceFileSystem << 16) | (FileAnyAccess << 14) | (57u << 2) | MethodNeither;
    private const uint FSCTL_READ_USN_JOURNAL = (FileDeviceFileSystem << 16) | (FileAnyAccess << 14) | (46u << 2) | MethodNeither;

    private const uint GenericRead = 0x80000000;
    private const uint GenericWrite = 0x40000000;
    private const uint FileShareRead = 0x00000001;
    private const uint FileShareWrite = 0x00000002;
    private const uint OpenExisting = 3;
    private const uint FileFlagBackupSemantics = 0x02000000;

    private const uint UsnReasonFileDelete = 0x00000200;
    private const uint UsnReasonRenameOldName = 0x00001000;
    private const uint UsnReasonClose = 0x80000000;

    private const int ErrorJournalDeleteInProgress = 1178;
    private const int ErrorJournalNotActive = 1179;

    private const int ReadBufferSize = 64 * 1024;

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern SafeFileHandle CreateFile(
        string fileName, uint desiredAccess, uint shareMode,
        nint securityAttributes, uint creationDisposition, uint flagsAndAttributes, nint templateFile);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool DeviceIoControl(
        SafeFileHandle hDevice, uint dwIoControlCode,
        byte[]? inBuffer, int nInBufferSize,
        [Out] byte[] outBuffer, int nOutBufferSize,
        out int bytesReturned, nint overlapped);

    [StructLayout(LayoutKind.Sequential)]
    private struct ByHandleFileInformation
    {
        public uint FileAttributes;
        public System.Runtime.InteropServices.ComTypes.FILETIME CreationTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastAccessTime;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWriteTime;
        public uint VolumeSerialNumber;
        public uint FileSizeHigh;
        public uint FileSizeLow;
        public uint NumberOfLinks;
        public uint FileIndexHigh;
        public uint FileIndexLow;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetFileInformationByHandle(SafeFileHandle hFile, out ByHandleFileInformation lpFileInformation);

    /// <summary>
    /// Gets the NTFS file reference number of a directory for USN parent resolution.
    /// </summary>
    public static bool TryGetDirectoryFrn(string directoryPath, out ulong frn)
    {
        frn = 0;
        SafeFileHandle handle;
        try
        {
            handle = CreateFile(directoryPath, GenericRead, FileShareRead | FileShareWrite,
                nint.Zero, OpenExisting, FileFlagBackupSemantics, nint.Zero);
        }
        catch
        {
            return false;
        }
        using (handle)
        {
            if (handle.IsInvalid) return false;
            if (!GetFileInformationByHandle(handle, out var info)) return false;
            frn = ((ulong)info.FileIndexHigh << 32) | info.FileIndexLow;
            return true;
        }
    }

    public sealed class JournalChanges
    {
        public List<UsnChange> Changes { get; } = new();
        public ulong JournalId { get; set; }
        public long NextUsn { get; set; }
    }

    /// <summary>
    /// Lightweight journal position query (no record reading).
    /// </summary>
    public static bool TryGetJournalState(string driveLetter, out ulong journalId, out long nextUsn)
    {
        journalId = 0;
        nextUsn = 0;
        using var volume = OpenVolume($@"\\.\{driveLetter}:", false);
        if (volume is null) return false;
        var journal = QueryJournal(volume);
        if (journal is null) return false;
        journalId = journal.Value.JournalId;
        nextUsn = journal.Value.NextUsn;
        return true;
    }

    /// <summary>
    /// Reads journal records newer than <paramref name="fromUsn"/> on a volume.
    /// Returns null when a full scan is required instead (with <paramref name="fallbackReason"/>).
    /// </summary>
    public static JournalChanges? TryReadChanges(
        string driveLetter,
        ulong expectedJournalId,
        long fromUsn,
        bool hasBaseline,
        IReadOnlyDictionary<ulong, string> directoryFrns,
        IReadOnlyList<string> scopeRoots,
        out string? fallbackReason)
    {
        fallbackReason = null;
        var volumePath = $@"\\.\{driveLetter}:";
        SafeFileHandle? volume = OpenVolume(volumePath, true);
        if (volume is null)
        {
            fallbackReason = $"Could not open volume {driveLetter}: for USN journal access.";
            return null;
        }
        using (volume)
        {
            var journal = QueryJournal(volume);
            if (journal is null)
            {
                // Journal does not exist; try to create it, then require a full scan baseline.
                if (!TryCreateJournal(volume))
                {
                    fallbackReason = $"No USN journal on volume {driveLetter}: and it could not be created.";
                    return null;
                }
                journal = QueryJournal(volume);
                if (journal is null)
                {
                    fallbackReason = $"USN journal on volume {driveLetter}: is still unavailable.";
                    return null;
                }
                fallbackReason = $"USN journal on volume {driveLetter}: was created; a full scan baseline is required.";
                return null;
            }
            if (hasBaseline && journal.Value.JournalId != expectedJournalId)
            {
                fallbackReason = $"USN journal on volume {driveLetter}: was recreated; a full scan is required.";
                return null;
            }
            if (hasBaseline && fromUsn < journal.Value.FirstUsn)
            {
                fallbackReason = $"USN journal on volume {driveLetter}: wrapped around; a full scan is required.";
                return null;
            }

            var result = new JournalChanges { JournalId = journal.Value.JournalId, NextUsn = journal.Value.NextUsn };
            var startUsn = hasBaseline ? fromUsn : journal.Value.FirstUsn;
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var unknownParent = false;
            var nextUsn = startUsn;
            var buffer = new byte[ReadBufferSize];
            while (true)
            {
                var input = BuildReadInput(nextUsn, journal.Value.JournalId);
                if (!DeviceIoControl(volume, FSCTL_READ_USN_JOURNAL, input, input.Length, buffer, buffer.Length, out var returned, nint.Zero))
                {
                    fallbackReason = $"Could not read the USN journal on volume {driveLetter}: (Win32 {Marshal.GetLastWin32Error()}).";
                    return null;
                }
                if (returned <= 8) break;
                nextUsn = BinaryPrimitives.ReadInt64LittleEndian(buffer.AsSpan(0, 8));
                var offset = 8;
                while (offset + 4 <= returned)
                {
                    var recordLength = (int)BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(offset, 4));
                    if (recordLength < 60 || offset + recordLength > returned) break;
                    ParseRecord(buffer, offset, recordLength, directoryFrns, scopeRoots, seen, result, ref unknownParent);
                    offset += recordLength;
                }
                if (nextUsn == startUsn) break;
                startUsn = nextUsn;
                if (returned < ReadBufferSize) break;
            }
            result.NextUsn = nextUsn == 0 ? journal.Value.NextUsn : nextUsn;
            if (unknownParent)
            {
                fallbackReason = $"USN journal on volume {driveLetter}: references unknown folders; a full scan is required.";
                return null;
            }
            return result;
        }
    }

    private static void ParseRecord(
        byte[] buffer, int offset, int recordLength,
        IReadOnlyDictionary<ulong, string> directoryFrns,
        IReadOnlyList<string> scopeRoots,
        HashSet<string> seen,
        JournalChanges result,
        ref bool unknownParent)
    {
        var major = buffer[offset + 4];
        ulong parentFrn;
        uint reason;
        int nameLength;
        int nameOffset;
        if (major >= 3)
        {
            if (recordLength < 76) return;
            parentFrn = BinaryPrimitives.ReadUInt64LittleEndian(buffer.AsSpan(offset + 24, 8));
            reason = BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(offset + 56, 4));
            nameLength = BinaryPrimitives.ReadUInt16LittleEndian(buffer.AsSpan(offset + 72, 2));
            nameOffset = BinaryPrimitives.ReadUInt16LittleEndian(buffer.AsSpan(offset + 74, 2));
        }
        else
        {
            if (recordLength < 60) return;
            parentFrn = BinaryPrimitives.ReadUInt64LittleEndian(buffer.AsSpan(offset + 16, 8));
            reason = BinaryPrimitives.ReadUInt32LittleEndian(buffer.AsSpan(offset + 40, 4));
            nameLength = BinaryPrimitives.ReadUInt16LittleEndian(buffer.AsSpan(offset + 56, 2));
            nameOffset = BinaryPrimitives.ReadUInt16LittleEndian(buffer.AsSpan(offset + 58, 2));
        }
        if ((reason & ~UsnReasonClose) == 0 || nameLength <= 0) return;
        if (nameOffset + nameLength > recordLength) return;
        var name = Encoding.Unicode.GetString(buffer, offset + nameOffset, nameLength);
        if (!directoryFrns.TryGetValue(parentFrn, out var parentPath))
        {
            unknownParent = true;
            return;
        }
        var fullPath = Path.Combine(parentPath, name);
        var inScope = false;
        foreach (var root in scopeRoots)
        {
            if (fullPath.StartsWith(root, StringComparison.OrdinalIgnoreCase))
            {
                inScope = true;
                break;
            }
        }
        if (!inScope) return;
        if (!seen.Add(fullPath)) return;
        var deleted = (reason & (UsnReasonFileDelete | UsnReasonRenameOldName)) != 0;
        result.Changes.Add(new UsnChange(fullPath, deleted));
    }

    private static SafeFileHandle? OpenVolume(string volumePath, bool writable)
    {
        try
        {
            var access = GenericRead | (writable ? GenericWrite : 0u);
            var handle = CreateFile(volumePath, access, FileShareRead | FileShareWrite,
                nint.Zero, OpenExisting, 0, nint.Zero);
            if (handle.IsInvalid)
            {
                handle.Dispose();
                if (writable)
                    return OpenVolume(volumePath, false);
                return null;
            }
            return handle;
        }
        catch
        {
            if (writable)
                return OpenVolume(volumePath, false);
            return null;
        }
    }

    private readonly record struct JournalData(ulong JournalId, long FirstUsn, long NextUsn);

    private static JournalData? QueryJournal(SafeFileHandle volume)
    {
        var output = new byte[80];
        if (!DeviceIoControl(volume, FSCTL_QUERY_USN_JOURNAL, null, 0, output, output.Length, out var returned, nint.Zero))
        {
            var error = Marshal.GetLastWin32Error();
            if (error is ErrorJournalNotActive or ErrorJournalDeleteInProgress)
                return null;
            return null;
        }
        if (returned < 56) return null;
        var span = output.AsSpan();
        return new JournalData(
            BinaryPrimitives.ReadUInt64LittleEndian(span[0..8]),
            BinaryPrimitives.ReadInt64LittleEndian(span[8..16]),
            BinaryPrimitives.ReadInt64LittleEndian(span[16..24]));
    }

    private static bool TryCreateJournal(SafeFileHandle volume)
    {
        var input = new byte[16];
        BinaryPrimitives.WriteUInt64LittleEndian(input.AsSpan(0, 8), 32UL * 1024 * 1024);
        BinaryPrimitives.WriteUInt64LittleEndian(input.AsSpan(8, 8), 4UL * 1024 * 1024);
        var output = new byte[8];
        if (!DeviceIoControl(volume, FSCTL_CREATE_USN_JOURNAL, input, input.Length, output, output.Length, out _, nint.Zero))
            return false;
        return true;
    }

    private static byte[] BuildReadInput(long startUsn, ulong journalId)
    {
        var input = new byte[40];
        var span = input.AsSpan();
        BinaryPrimitives.WriteInt64LittleEndian(span[0..8], startUsn);
        BinaryPrimitives.WriteUInt32LittleEndian(span[8..12], 0xFFFFFFFF);
        BinaryPrimitives.WriteUInt32LittleEndian(span[12..16], 0);
        BinaryPrimitives.WriteInt64LittleEndian(span[16..24], 0);
        BinaryPrimitives.WriteInt64LittleEndian(span[24..32], 0);
        BinaryPrimitives.WriteUInt64LittleEndian(span[32..40], journalId);
        return input;
    }
}
