using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using LanVault.Agent.Configuration;
using LanVault.Agent.Models;

namespace LanVault.Agent.Services;

/// <summary>Collects live, local machine facts. It never invents devices or disk records.</summary>
public sealed class DeviceInspector(ILogger<DeviceInspector> logger)
{
    public DeviceRegistrationRequest CollectRegistration(string? bootstrapToken)
    {
        var network = FindPrimaryNetworkAdapter();
        var user = string.IsNullOrWhiteSpace(Environment.UserDomainName)
            ? Environment.UserName
            : $"{Environment.UserDomainName}\\{Environment.UserName}";

        return new DeviceRegistrationRequest
        {
            AgentToken = string.IsNullOrWhiteSpace(bootstrapToken) ? null : bootstrapToken,
            ComputerName = Environment.MachineName,
            WindowsUsername = user,
            IpAddress = network?.Address,
            MacAddress = network?.MacAddress,
            OperatingSystem = RuntimeInformation.OSDescription.Trim(),
            AgentVersion = AgentVersion.Current,
            Disks = CollectDisks()
        };
    }

    public IReadOnlyList<DiskSnapshot> CollectDisks()
    {
        var disks = new List<DiskSnapshot>();

        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (!drive.IsReady || (drive.DriveType != DriveType.Fixed && drive.DriveType != DriveType.Removable))
                {
                    continue;
                }

                var letter = NormalizeDriveId(drive.Name);
                disks.Add(new DiskSnapshot
                {
                    Id = letter,
                    Name = string.IsNullOrWhiteSpace(drive.VolumeLabel) ? letter : drive.VolumeLabel,
                    Letter = letter,
                    FileSystem = drive.DriveFormat,
                    TotalBytes = drive.TotalSize,
                    FreeBytes = drive.AvailableFreeSpace
                });
            }
            catch (IOException exception)
            {
                logger.LogWarning(exception, "Could not inspect drive {DriveName}.", drive.Name);
            }
            catch (UnauthorizedAccessException exception)
            {
                logger.LogWarning(exception, "Access was denied while inspecting drive {DriveName}.", drive.Name);
            }
        }

        return disks.OrderBy(disk => disk.Id, StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static string NormalizeDriveId(string driveName)
    {
        var root = Path.GetPathRoot(driveName) ?? driveName;
        return root.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static NetworkSnapshot? FindPrimaryNetworkAdapter()
    {
        foreach (var adapter in NetworkInterface.GetAllNetworkInterfaces()
                     .Where(adapter => adapter.OperationalStatus == OperationalStatus.Up)
                     .Where(adapter => adapter.NetworkInterfaceType is not NetworkInterfaceType.Loopback and not NetworkInterfaceType.Tunnel)
                     .OrderBy(adapter => adapter.NetworkInterfaceType == NetworkInterfaceType.Ethernet ? 0 : 1))
        {
            var address = adapter.GetIPProperties().UnicastAddresses
                .Select(unicast => unicast.Address)
                .FirstOrDefault(ip => ip.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(ip));

            if (address is not null)
            {
                var mac = string.Join("-", adapter.GetPhysicalAddress().GetAddressBytes().Select(value => value.ToString("X2")));
                return new NetworkSnapshot(address.ToString(), string.IsNullOrWhiteSpace(mac) ? null : mac);
            }
        }

        return null;
    }

    private sealed record NetworkSnapshot(string Address, string? MacAddress);
}
