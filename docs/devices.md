# Device management

The Devices page is the administrative inventory for enrolled LanVault Agents.
Use the search box to match a computer name or IP address and the approval
filter to narrow the list. Summary cards and the result range describe the
currently filtered page; pagination controls are below the inventory.

## Enroll and approve a device

1. Install the LanVault Agent on the Windows computer, or use **Discover
   devices** to refresh the list of Agents that have registered with the server.
2. A newly registered computer appears with **Pending approval**. Review its
   name, network address, and Agent status before approving it.
3. Select the device name to open its dedicated details panel. Review its
   connection and Agent information, then select the disks that are allowed to
   be backed up. Disk selection is explicit; newly discovered disks are not
   selected automatically.
4. Open **Device Backups** to start a full or incremental backup for the
   approved device.

Approving a device does not itself start a backup. A device must be approved
and have at least one selected disk before a backup job can be queued.

## Backup delivery and server storage

Queued means the Agent has not yet reported that it started the job; it is not
an approval status. After receiving the command, the Agent reports the job as
running, inventories the selected files, and uploads file contents through its
configured LanVault API connection. The backup destination is resolved on the
server, not as a local path on the Agent computer, so the server service
account must be able to write to that folder or network share. During a large
inventory, progress can remain at 0% while the status is running; uploaded byte
counts increase once transfers begin.

Each successfully uploaded file and each unchanged file reused from an earlier
backup is recorded in that backup's run log with its source drive, relative
path, size, and destination slot. Files that fail to copy are recorded as
warnings. Open **Run logs** on the backup job to browse the newest events; logs
are paginated and refresh while the panel is open.

On the Device Backups page, switch between three-column backup cards and the
compact table layout from the jobs header. Both layouts retain progress,
history, run logs, and stop controls.

## Monitor Agent status and update it

The inventory can be switched between a three-column card layout and the
compact table layout using the view controls in its header. Both layouts show
connection state, approval state, Agent version, selected disk count, and
update availability. Select a device name or the details control to view that
computer's details in a separate panel rather than expanding the table row.
The panel groups Agent health, device metadata, and backup disk selection
independently. When an update is available, select **Update Agent**. Updates are sent only to
an approved, online device and are rejected while that device has a queued or
active backup.

The update lifecycle shown in the inventory is:

- **Queued**: the server has saved an update command for the Agent.
- **Downloading**: the Agent is downloading the published package.
- **Installing**: the package checksum was verified and the Windows service is
  being restarted with the new executable.
- **Current**: the Agent reported the published build after reconnecting.
- **Failed**: the update failed; the row shows the reported error and the
  action can be retried.

The Devices page refreshes every three seconds while an update is active. A
successful update briefly interrupts the Agent's connection while its Windows
service restarts. The update process runs without opening an interactive window
on the client.

Agents must support self-update before they can receive an update command.
Install the self-update-capable Agent manually once on older installations;
subsequent updates can be started from this page.

## Device actions

- **Approve** enables backup operations; **Reject** denies a pending device.
- **Revoke approval** returns an approved device to the pending state.
- **Delete** removes the device record and associated database records.
- **Select disks** in the device details panel to control which volumes are
  included in future backup jobs.
