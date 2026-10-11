using LanVault.Agent.Configuration;
using LanVault.Agent.Services;
using LanVault.Agent.Workers;
using Microsoft.Extensions.Options;

var builder = Host.CreateApplicationBuilder(args);

builder.Configuration.AddEnvironmentVariables(prefix: "LANVAULT_AGENT_");

builder.Services
    .AddOptions<AgentOptions>()
    .Bind(builder.Configuration.GetSection(AgentOptions.SectionName))
    .Configure(options => options.ApplyFriendlyEnvironmentOverrides())
    .ValidateDataAnnotations()
    .Validate(options => options.IsValid(out _), "LanVault Agent configuration is invalid.")
    .ValidateOnStart();

builder.Services.AddWindowsService(options => options.ServiceName = "LanVault Agent");

builder.Logging.ClearProviders();
builder.Logging.AddConfiguration(builder.Configuration.GetSection("Logging"));
builder.Logging.AddConsole();
builder.Logging.AddEventLog(eventLogSettings =>
{
    eventLogSettings.SourceName = "LanVault Agent";
    eventLogSettings.LogName = "Application";
});

builder.Services.AddHttpClient<AgentApiClient>((services, client) =>
{
    var options = services.GetRequiredService<IOptions<AgentOptions>>().Value;
    client.BaseAddress = new Uri(options.Server.BaseUrl, UriKind.Absolute);
    client.Timeout = TimeSpan.FromSeconds(options.RequestTimeoutSeconds);
    client.DefaultRequestHeaders.UserAgent.ParseAdd($"LanVault-Agent/{AgentVersion.Current}");
});
builder.Services.AddHttpClient("BackupUpload", (services, client) =>
{
    var options = services.GetRequiredService<IOptions<AgentOptions>>().Value;
    client.BaseAddress = new Uri(options.Server.BaseUrl, UriKind.Absolute);
    client.Timeout = Timeout.InfiniteTimeSpan;
    client.DefaultRequestHeaders.UserAgent.ParseAdd($"LanVault-Agent/{AgentVersion.Current}");
});

builder.Services.AddSingleton<DeviceInspector>();
builder.Services.AddSingleton<AgentIdentityStore>();
builder.Services.AddSingleton<AgentRuntimeState>();
builder.Services.AddSingleton<UsnStateStore>();
builder.Services.AddSingleton<VssSnapshotService>();
builder.Services.AddSingleton<BackupExecutor>();
builder.Services.AddSingleton<BackupManager>();
builder.Services.AddSingleton<RestoreManager>();
builder.Services.AddSingleton<AgentUpdateManager>();
builder.Services.AddHostedService<AgentWorker>();

var host = builder.Build();
await host.RunAsync();
