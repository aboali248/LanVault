# LanVault

LanVault is a LAN backup console backed by a real SQLite database and Windows
Worker Service agents. The database starts empty; no sample devices, groups, or
backup jobs are seeded.

## Requirements

- Node.js 22 or newer
- .NET 8 SDK (the API publishes the Windows Agent installer at startup/build time)
- Windows for running the Agent as a Windows Service

## Start the API

```powershell
Copy-Item backend\.env.example backend\.env
Set-Location backend
npm install
npm run dev
```

The default Windows backup destination is `E:\LanVault-Backup`. Agents upload
backup files over the LanVault API connection; the API server writes them to
its configured destination, so client devices do not need the same drive
letter or a network share. Set `BACKUP_DESTINATION` to override the default.

The Settings folder browser lists paths from the LanVault server, and the
storage check tests the current form values there. The API creates the selected
destination folder as needed and writes uploaded backup files on the server.

Agent enrollment remains disabled unless `AGENT_BOOTSTRAP_TOKEN` is configured
with a long, random deployment secret. The API stores only a hash of each
agent-issued credential. SQLite data defaults to `backend\data\lanvault.db`.

The initial sign-in accounts are `admin` / `1` and `user` / `1`, as requested.
Change both `AUTH_ADMIN_PASSWORD` and `AUTH_USER_PASSWORD` in `backend\.env`
before allowing access to the LAN. Set a stable, random `AUTH_TOKEN_SECRET` to
keep sessions valid across API restarts; if it is omitted, a temporary key is
generated at startup and all sessions expire when the API restarts.

The API listens on port `3031` by default. Its readiness endpoint is
`http://localhost:3031/health`; the REST API is under `/api/v1`. Browser
progress and device-state events use `/ws`. The API binds to `0.0.0.0` and
Vite listens on the LAN interfaces so other computers can connect. Open the
configured API and frontend ports in the Windows firewall for the trusted LAN.

## Start the web application

```powershell
Set-Location frontend
npm install
npm run dev
```

Vite serves the UI at `http://localhost:3030`; open the same port from other
LAN computers using the server's IP address. The API host is inferred from
the browser URL by default. Set `VITE_API_URL` and `VITE_WS_URL` only when the
API is not at its defaults.

On Windows, use [Start-LanVault.bat](./Start-LanVault.bat) in the project root
to run both services in one terminal on ports `3031` (API) and `3030` (web).
The terminal shows output from both services; press `Ctrl+C` to stop them. If
either port is already in use, the launcher stops its current listener before
starting LanVault. It initializes `backend\.env` when needed and generates
persistent, random enrollment/session secrets there. Change the default
admin/user passwords from `1` before allowing LAN access. Use
[Stop-LanVault.bat](./Stop-LanVault.bat) to stop the LanVault listeners
separately when needed.

## Windows Agent

Sign in to the web app as `user` and download **LanVault Agent Installer (.bat)**.
Run it from an elevated PowerShell on the computer to be managed. It downloads
the published Windows Agent from the API, sets its server URL and bootstrap
token, installs the `LanVaultAgent` Windows service, and starts enrollment.
The device appears as pending; an administrator must approve it and select
the disks before any backup can begin. Agent enrollment and agent credentials
are separate from the user/admin web sign-in.
The installer keeps its window open and writes diagnostics to
`C:\ProgramData\LanVault\agent-installer.log`.
The installer download is available at `/api/v1/agents/installer`; the legacy
`/api/agent/v1/install-script` path is retained for compatibility. Both
installer-script routes require an authenticated user session.

The API builds the self-contained `win-x64` Agent into `backend\.runtime\agent` before
starting, building, or running the backend. The generated executable is not
checked into source control. To build it separately:

```powershell
Set-Location backend
npm run publish-agent
```

The Agent reports its actual machine/network/disks, stores its issued credential
with Windows DPAPI, polls asynchronously for commands, and copies selected
disk files to the configured destination. Disks are never selected on
enrollment. A backup starts only after administrator approval and explicit
disk selection. Backups are stored under
`<destination>\<computer-name>` as original files
arranged under their selected partition and relative paths; incremental snapshots use
hardlinks for unchanged files where supported, and retention removes older
snapshot folders after a successful run. Folders from older
`<computer-name>_<device-id>` naming are renamed automatically on first use.

Completed backups record each file's size and SHA-256 hash. Incremental runs
reuse unchanged server-side copies and upload changed files only. An automatic
run that protects nothing new is removed silently instead of piling up empty
backups; manual runs are always kept. Every
uploaded version is retained by content hash in a shared per-destination store
(`<destination>\.blobs`), so identical files across devices and backups are
stored once and the **Browse backups**
page can open any dated backup, browse its drives/folders, and queue any file
or whole folder for restore to its original path; each file also shows its
older versions for point-in-time restore. When a complete
disk inventory no longer contains a previously backed-up file, it appears in
**Restore files** and a live alert is shown; administrators can queue selected files to be restored to
their original paths when the approved Agent next connects. Backups containing
the only retained copy of a deleted file are preserved for restoration.
Version blobs outside the retention window are cleaned up automatically.
Older, non-live versions are transparently gzip-compressed during maintenance,
and per-device legacy blob folders are consolidated into the shared store.
A device can optionally store its live mirrors as per-file `.zip` archives
instead of raw files (Device details → archive settings, off by default):
without a password the zip is plain deflate, with a password it is AES-256
encrypted (open with 7-Zip/WinRAR; Windows Explorer cannot open AES zips).
The password is stored reversibly on the server because restores need it, so
use this only on a trusted LAN. Deduplication, delta uploads, browsing, and
agent restores keep working on the raw retained bytes.
Each department can define its own automatic backup window (from/to time plus
weekdays) when it is created; group devices back up incrementally once per
selected day inside that window with no per-device schedule needed. Department
windows are the single source of backup timing: ungrouped devices only back up
manually, and no other automatic timing control exists. Each device card also
carries its own continuous-backup on/off switch, and each department offers a
master switch for all its devices.

Administrators can create daily or weekly schedules for an approved device or
group, select full or incremental mode, and set a retention override. A
schedule can also repeat every 5–1440 minutes inside a daily time window
(e.g. every 60 minutes from 08:00 to 18:00) per device or group. Schedule
times use the API server's local timezone. Group schedules skip devices that
are offline, unapproved, or have no selected disks. A failed scheduled run
raises a `schedule_failed` alert naming the cause; the alert resolves itself
after the next successful run. Each schedule card shows its computed next run
and the result of its latest backup.

For zero per-device setup, **Settings → Backup settings → Automatic schedule
for all devices** runs one daily/weekly backup for every approved device with
no target selection: newly approved devices are picked up automatically and
unready devices are skipped. Its next/last run status is shown in Settings.

Active alerts are raised when an Agent goes offline, a backup fails, or a
configured storage destination is unavailable or below the free-space
threshold. Configure an optional secondary destination under **Settings →
Backup settings** for a second copy. The Agent uploads each file once; the
API server copies it to the secondary destination in the background, so the
LAN is never used twice and an unavailable secondary drive no longer blocks
new backups — it catches up when it is back. Each Agent uploads files to the API, which stores the primary copy and
replicates it to the secondary destination in the background.

The server publishes a SHA-256 manifest with the Windows Agent package. Device
management compares each connected Agent build to that manifest and lets an
administrator queue a verified update for an online approved device. The Agent
stages and hashes the package, then a separate helper stops the Windows service,
replaces the executable with rollback available, and starts it again. An active
backup must finish before an update can be queued. Agents installed before this
self-update support was added need one manual update first; later updates can
be initiated from the Devices page, where queued, downloading, installing, and
failed states are shown and refreshed while an update is in progress.

## Layout

- `frontend/src/pages/`: isolated Dashboard, Devices, DeviceBackups, Groups,
  and Settings screens with page-local components.
- `backend/src/modules/`: device, backup, group, settings, and agent APIs.
- `backend/src/database/`: SQLite connection and versioned migrations.
- `agent/`: Windows Worker Service and file-copy execution.
- `docs/devices.md`: device enrollment, approval, Agent update, and device action
  documentation.

The REST API uses validated JSON requests and paginated list responses.
Administrator APIs and real-time device events require an administrator
session. The user role can only download the Agent installer. WebSocket events
are hints; HTTP/SQLite remain authoritative. Credentials default to `1` only
for initial setup: change them and restrict access to a trusted LAN. HTTP is
not encrypted; deploy TLS before using this on untrusted networks.
