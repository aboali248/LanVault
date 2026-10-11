using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Diagnostics;
using System.Text.Json;
using System.Globalization;
using LanVault.Agent.Configuration;
using LanVault.Agent.Models;
using Microsoft.Extensions.Options;

namespace LanVault.Agent.Services;

public sealed class AgentApiClient(HttpClient httpClient, IHttpClientFactory httpClientFactory, IOptions<AgentOptions> options)
{
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly string _basePath = options.Value.Server.BaseUrl.TrimEnd('/') + "/";
    private readonly HttpClient _backupUploadClient = httpClientFactory.CreateClient("BackupUpload");

    public async Task<DeviceRegistrationResponse> RegisterAsync(DeviceRegistrationRequest request, CancellationToken cancellationToken)
    {
        using var response = await httpClient.PostAsJsonAsync(new Uri(new Uri(_basePath), "agents/register"), request, JsonOptions, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
        var envelope = await response.Content.ReadFromJsonAsync<ApiEnvelope<DeviceRegistrationResponse>>(JsonOptions, cancellationToken)
            ?? throw new InvalidDataException("Registration returned an empty response.");
        return envelope.Data;
    }

    public async Task<HeartbeatResponse> HeartbeatAsync(string deviceId, string token, HeartbeatRequest request, CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/heartbeat", token);
        message.Content = JsonContent.Create(request, options: JsonOptions);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
        var envelope = await response.Content.ReadFromJsonAsync<ApiEnvelope<HeartbeatResponse>>(JsonOptions, cancellationToken)
            ?? throw new InvalidDataException("Heartbeat returned an empty response.");
        return envelope.Data;
    }

    public async Task AcknowledgeAsync(string deviceId, string commandId, string token, CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/commands/{Uri.EscapeDataString(commandId)}/ack", token);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
    }

    public async Task CompleteCommandAsync(string deviceId, string commandId, string token, CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/commands/{Uri.EscapeDataString(commandId)}/complete", token);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
    }

    public async Task ReportProgressAsync(string deviceId, string backupId, string token, BackupProgressRequest progress, CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/backups/{Uri.EscapeDataString(backupId)}/progress", token);
        message.Content = JsonContent.Create(progress, options: JsonOptions);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
    }

    public async Task ReportBackupLogAsync(string deviceId, string backupId, string token, string level, string messageText, CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/backups/{Uri.EscapeDataString(backupId)}/logs", token);
        message.Content = JsonContent.Create(new { level, message = messageText }, options: JsonOptions);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
    }

    public async Task UploadBackupFileAsync(
        string deviceId,
        string backupId,
        string drive,
        string relativePath,
        string destinationSlot,
        long sizeBytes,
        long lastWriteTicks,
        string sha256,
        string sourcePath,
        double? maxTransferRateMbps,
        string token,
        Func<long, Task>? onProgress,
        CancellationToken cancellationToken)
    {
        var query = $"?drive={Uri.EscapeDataString(drive)}&path={Uri.EscapeDataString(relativePath)}&slot={Uri.EscapeDataString(destinationSlot)}&sizeBytes={sizeBytes.ToString(CultureInfo.InvariantCulture)}&lastWriteTicks={lastWriteTicks.ToString(CultureInfo.InvariantCulture)}&sha256={Uri.EscapeDataString(sha256)}";
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/backups/{Uri.EscapeDataString(backupId)}/files{query}", token);
        var source = new FileStream(sourcePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        message.Content = new StreamContent(new RateLimitedReadStream(source, maxTransferRateMbps, onProgress));
        message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var response = await _backupUploadClient.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
    }

    public async Task<bool> CloneBackupFileAsync(
        string deviceId,
        string backupId,
        string drive,
        string relativePath,
        string destinationSlot,
        long sizeBytes,
        long lastWriteTicks,
        string sha256,
        string token,
        CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/backups/{Uri.EscapeDataString(backupId)}/files/clone", token);
        message.Content = JsonContent.Create(new
        {
            drive,
            path = relativePath,
            slot = destinationSlot,
            sizeBytes,
            lastWriteTicks = lastWriteTicks.ToString(CultureInfo.InvariantCulture),
            sha256,
        }, options: JsonOptions);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
        var envelope = await response.Content.ReadFromJsonAsync<ApiEnvelope<CloneFileResponse>>(JsonOptions, cancellationToken)
            ?? throw new InvalidDataException("Backup file clone returned an empty response.");
        return envelope.Data.Cloned;
    }

    public async Task DownloadDeletedFileAsync(
        string deviceId,
        string deletedFileId,
        string token,
        string destinationPath,
        CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Get, $"agents/{Uri.EscapeDataString(deviceId)}/restores/{Uri.EscapeDataString(deletedFileId)}/file", token);
        using var response = await _backupUploadClient.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var destination = new FileStream(destinationPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await source.CopyToAsync(destination, cancellationToken);
        await destination.FlushAsync(cancellationToken);
    }

    public async Task ReportDeletedFileRestoreAsync(
        string deviceId,
        string deletedFileId,
        string token,
        string? errorMessage,
        CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/restores/{Uri.EscapeDataString(deletedFileId)}/result", token);
        message.Content = JsonContent.Create(new { errorMessage }, options: JsonOptions);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
    }

    public async Task ReportDeletedPathsAsync(
        string deviceId,
        string backupId,
        string token,
        IReadOnlyList<(string Drive, string RelativePath)> paths,
        CancellationToken cancellationToken)
    {
        const int batchSize = 1000;
        for (var offset = 0; offset < paths.Count; offset += batchSize)
        {
            var batch = paths.Skip(offset).Take(batchSize)
                .Select(path => new { drive = path.Drive, relativePath = path.RelativePath })
                .ToList();
            using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/backups/{Uri.EscapeDataString(backupId)}/deleted-paths", token);
            message.Content = JsonContent.Create(new { paths = batch }, options: JsonOptions);
            using var response = await httpClient.SendAsync(message, cancellationToken);
            await EnsureSuccess(response, cancellationToken);
        }
    }

    public async Task<IReadOnlyList<int>> QueryMissingChunksAsync(
        string deviceId,
        string backupId,
        string drive,
        string relativePath,
        string destinationSlot,
        long sizeBytes,
        int chunkSize,
        IReadOnlyList<string> chunkShas,
        string token,
        CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/backups/{Uri.EscapeDataString(backupId)}/files/chunks/query", token);
        message.Content = JsonContent.Create(new
        {
            drive,
            path = relativePath,
            slot = destinationSlot,
            sizeBytes,
            chunkSize,
            chunks = chunkShas,
        }, options: JsonOptions);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
        var envelope = await response.Content.ReadFromJsonAsync<ApiEnvelope<MissingChunksResponse>>(JsonOptions, cancellationToken)
            ?? throw new InvalidDataException("Chunk query returned an empty response.");
        return envelope.Data.Missing;
    }

    public async Task UploadChunkAsync(
        string deviceId,
        string backupId,
        string drive,
        string relativePath,
        string destinationSlot,
        int chunkIndex,
        string chunkSha,
        string sourcePath,
        long chunkOffset,
        int chunkLength,
        string token,
        Func<long, Task>? onProgress,
        CancellationToken cancellationToken)
    {
        var query = $"?drive={Uri.EscapeDataString(drive)}&path={Uri.EscapeDataString(relativePath)}&slot={Uri.EscapeDataString(destinationSlot)}&chunkIndex={chunkIndex.ToString(CultureInfo.InvariantCulture)}&sha256={Uri.EscapeDataString(chunkSha)}";
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/backups/{Uri.EscapeDataString(backupId)}/files/chunks{query}", token);
        var source = new ChunkReadStream(sourcePath, chunkOffset, chunkLength, onProgress);
        message.Content = new StreamContent(source);
        message.Content.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");
        using var response = await _backupUploadClient.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
    }

    public async Task AssembleChunksAsync(
        string deviceId,
        string backupId,
        string drive,
        string relativePath,
        string destinationSlot,
        long sizeBytes,
        long lastWriteTicks,
        string sha256,
        int chunkSize,
        IReadOnlyList<string> chunkShas,
        string token,
        CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/backups/{Uri.EscapeDataString(backupId)}/files/chunks/assemble", token);
        message.Content = JsonContent.Create(new
        {
            drive,
            path = relativePath,
            slot = destinationSlot,
            sizeBytes,
            lastWriteTicks = lastWriteTicks.ToString(CultureInfo.InvariantCulture),
            sha256,
            chunkSize,
            chunkShas,
        }, options: JsonOptions);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
    }

    public async Task DownloadBackupFileAsync(
        string deviceId,
        string backupId,
        string drive,
        string relativePath,
        string token,
        string destinationPath,
        CancellationToken cancellationToken)
    {
        var query = $"?drive={Uri.EscapeDataString(drive)}&path={Uri.EscapeDataString(relativePath)}";
        using var message = CreateRequest(HttpMethod.Get, $"agents/{Uri.EscapeDataString(deviceId)}/backup-files/{Uri.EscapeDataString(backupId)}/file{query}", token);
        using var response = await _backupUploadClient.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var destination = new FileStream(destinationPath, FileMode.CreateNew, FileAccess.Write, FileShare.None, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await source.CopyToAsync(destination, cancellationToken);
        await destination.FlushAsync(cancellationToken);
    }

    public async Task ReportFileRestoreAsync(
        string deviceId,
        string backupId,
        string drive,
        string relativePath,
        string token,
        string? errorMessage,
        CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/file-restores/result", token);
        message.Content = JsonContent.Create(new { backupId, drive, relativePath, errorMessage }, options: JsonOptions);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
    }

    public async Task DownloadAgentUpdateAsync(
        string deviceId,
        string buildHash,
        string token,
        string destinationPath,
        CancellationToken cancellationToken)
    {
        using var message = CreateRequest(
            HttpMethod.Get,
            $"agents/{Uri.EscapeDataString(deviceId)}/updates/{Uri.EscapeDataString(buildHash)}/agent.exe",
            token);
        using var response = await _backupUploadClient.SendAsync(message, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
        await using var source = await response.Content.ReadAsStreamAsync(cancellationToken);
        await using var destination = new FileStream(
            destinationPath, FileMode.CreateNew, FileAccess.Write, FileShare.None,
            1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        await source.CopyToAsync(destination, cancellationToken);
        await destination.FlushAsync(cancellationToken);
    }

    public async Task ReportAgentUpdateStatusAsync(
        string deviceId,
        string token,
        string status,
        string? errorMessage,
        CancellationToken cancellationToken)
    {
        using var message = CreateRequest(HttpMethod.Post, $"agents/{Uri.EscapeDataString(deviceId)}/update-status", token);
        message.Content = JsonContent.Create(new { status, errorMessage }, options: JsonOptions);
        using var response = await httpClient.SendAsync(message, cancellationToken);
        await EnsureSuccess(response, cancellationToken);
    }

    private HttpRequestMessage CreateRequest(HttpMethod method, string path, string token)
    {
        var request = new HttpRequestMessage(method, new Uri(new Uri(_basePath), path));
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return request;
    }

    private static async Task EnsureSuccess(HttpResponseMessage response, CancellationToken cancellationToken)
    {
        if (response.IsSuccessStatusCode) return;
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        throw new HttpRequestException($"LanVault API returned {(int)response.StatusCode} ({response.ReasonPhrase}): {body}", null, response.StatusCode);
    }

    private sealed record ApiEnvelope<T>(T Data);
    private sealed record CloneFileResponse(bool Cloned);
    private sealed record MissingChunksResponse(IReadOnlyList<int> Missing);

    private sealed class ChunkReadStream(
        string sourcePath,
        long offset,
        int length,
        Func<long, Task>? onProgress) : Stream
    {
        private readonly FileStream _inner = new(sourcePath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1024 * 1024, FileOptions.Asynchronous | FileOptions.SequentialScan);
        private long _position;
        private long _sent;

        public override bool CanRead => true;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() => throw new NotSupportedException();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            if (_position >= length) return 0;
            if (_position == 0) _inner.Seek(offset, SeekOrigin.Begin);
            var remaining = length - _position;
            if (buffer.Length > remaining) buffer = buffer[..(int)remaining];
            var read = await _inner.ReadAsync(buffer, cancellationToken);
            if (read == 0) return 0;
            _position += read;
            _sent += read;
            if (onProgress is not null) await onProgress(_sent);
            return read;
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        protected override void Dispose(bool disposing)
        {
            if (disposing) _inner.Dispose();
            base.Dispose(disposing);
        }

        public override async ValueTask DisposeAsync()
        {
            await _inner.DisposeAsync();
            GC.SuppressFinalize(this);
        }
    }

    private sealed class RateLimitedReadStream(
        Stream inner,
        double? maxTransferRateMbps,
        Func<long, Task>? onProgress) : Stream
    {
        private readonly Stopwatch _elapsed = Stopwatch.StartNew();
        private long _bytesRead;
        private readonly double _bytesPerSecond = maxTransferRateMbps is > 0 ? maxTransferRateMbps.Value * 1024 * 1024 : 0;

        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => false;
        public override bool CanWrite => false;
        public override long Length => throw new NotSupportedException();
        public override long Position { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }
        public override void Flush() => throw new NotSupportedException();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();

        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
        {
            var read = await inner.ReadAsync(buffer, cancellationToken);
            if (read == 0)
            {
                if (onProgress is not null) await onProgress(_bytesRead);
                return read;
            }
            _bytesRead += read;
            if (_bytesPerSecond > 0)
            {
                var expectedElapsed = TimeSpan.FromSeconds(_bytesRead / _bytesPerSecond);
                var delay = expectedElapsed - _elapsed.Elapsed;
                if (delay > TimeSpan.Zero) await Task.Delay(delay, cancellationToken);
            }
            if (onProgress is not null) await onProgress(_bytesRead);
            return read;
        }

        public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken cancellationToken)
            => ReadAsync(buffer.AsMemory(offset, count), cancellationToken).AsTask();

        protected override void Dispose(bool disposing)
        {
            if (disposing) inner.Dispose();
            base.Dispose(disposing);
        }

        public override async ValueTask DisposeAsync()
        {
            await inner.DisposeAsync();
            GC.SuppressFinalize(this);
        }
    }
}
