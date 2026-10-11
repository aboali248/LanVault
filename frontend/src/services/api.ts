import type {
  AppSettings, AutoScheduleStatus, Backup, BackupKind, BackupLog, BackupSchedule, BackupTreeDrive, BackupTreeFile, DashboardOverview, Device, DeviceInput, FileVersion, Group, GroupInput,
  DeletedFile, Notification, PaginatedResult, ProtectionSummary, ReplicationStatus, RestoreBackupFileItem, StorageBrowseResult, StorageCheckResult,
} from '../types';

const apiBaseUrl = (import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:3031/api/v1`).replace(/\/$/, '');

export class ApiError extends Error {
  readonly status: number;
  readonly details?: unknown;
  constructor(message: string, status = 0, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

type RequestOptions = Omit<RequestInit, 'body'> & { body?: unknown };

function toQuery(params: Record<string, string | number | boolean | undefined | null>) {
  const query = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  });
  const encoded = query.toString();
  return encoded ? `?${encoded}` : '';
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, headers, ...init } = options;
  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(sessionStorage.getItem('lanvault-session-token')
          ? { Authorization: `Bearer ${sessionStorage.getItem('lanvault-session-token')}` }
          : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    throw new ApiError(error instanceof Error ? `Network error: ${error.message}` : 'Network error');
  }

  const raw = await response.text();
  let parsed: unknown = null;
  if (raw) {
    try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  }
  if (!response.ok) {
    if (response.status === 401 && path !== '/auth/login') {
      sessionStorage.removeItem('lanvault-session-token');
      sessionStorage.removeItem('lanvault-session-role');
      window.dispatchEvent(new Event('lanvault:unauthorized'));
    }
    const record = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
    const nested = record.error && typeof record.error === 'object' ? record.error as Record<string, unknown> : {};
    const message = typeof record.message === 'string' ? record.message
      : typeof nested.message === 'string' ? nested.message
        : typeof record.error === 'string' ? record.error : `Request failed (${response.status})`;
    throw new ApiError(message, response.status, nested.details ?? record.details);
  }
  if (parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>) &&
      !('pagination' in (parsed as Record<string, unknown>))) {
    return (parsed as { data: T }).data;
  }
  return parsed as T;
}

interface PagePayload<T> { data: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }
async function paginated<T>(path: string): Promise<PaginatedResult<T>> {
  const result = await request<PagePayload<T>>(path);
  return { items: result.data, pagination: result.pagination };
}

type ApiDevice = {
  id: string; computerName: string; windowsUsername: string | null; ipAddress: string | null;
  macAddress: string | null; operatingSystem: string | null; approvalStatus: Device['approvalStatus'];
  status: Device['status']; agentStatus: string; agentVersion: string | null; lastSeenAt: string | null;
  latestAgentVersion: string | null; agentBuildHash: string | null; agentUpdateAvailable: boolean;
  agentUpdateStatus: Device['agentUpdateStatus']; agentUpdateError: string | null;
  backupExcludedExtensions: string[]; backupIncludedExtensions: string[];
  continuousBackupEnabled: boolean; backupIntervalMinutes: number | null;
  archiveMode: 'off' | 'zip'; hasArchivePassword: boolean;
  group: Device['group']; createdAt: string; updatedAt: string;
  disks?: Array<{ id: string; name: string; letter: string | null; fileSystem: string | null; totalBytes: number | null; freeBytes: number | null; isSelected: boolean }>;
};
function mapDevice(device: ApiDevice): Device {
  return {
    ...device,
    approved: device.approvalStatus === 'approved',
    continuousBackupEnabled: Boolean(device.continuousBackupEnabled),
    backupIntervalMinutes: device.backupIntervalMinutes ?? null,
    archiveMode: device.archiveMode === 'zip' ? 'zip' : 'off',
    hasArchivePassword: Boolean(device.hasArchivePassword),
    agentStatus: device.agentStatus === 'online' ? 'connected'
      : device.agentStatus === 'registered' ? 'pending'
        : device.agentStatus === 'offline' ? 'disconnected' : device.agentStatus as Device['agentStatus'],
    agentVersion: device.agentVersion,
    latestAgentVersion: device.latestAgentVersion,
    agentBuildHash: device.agentBuildHash,
    agentUpdateAvailable: device.agentUpdateAvailable,
    agentUpdateStatus: device.agentUpdateStatus,
    agentUpdateError: device.agentUpdateError,
    disks: (device.disks ?? []).map((disk) => ({
      id: disk.id, deviceId: device.id, label: disk.name, mountPoint: disk.letter,
      filesystem: disk.fileSystem ?? undefined, totalBytes: disk.totalBytes ?? 0,
      freeBytes: disk.freeBytes ?? 0, selectedForBackup: disk.isSelected,
    })),
  };
}

type ApiBackup = {
  id: string; deviceId: string; device: { computerName: string }; mode: BackupKind;
  status: Backup['status']; progressPercent: number; bytesProcessed: number;
  totalBytes: number | null; backupSizeBytes: number | null; requestedAt: string;
  startedAt: string | null; completedAt: string | null; errorMessage: string | null;
  disks: Array<{ id: string; name: string; letter: string | null }>;
};
function mapBackup(backup: ApiBackup): Backup {
  return {
    id: backup.id, deviceId: backup.deviceId, deviceName: backup.device.computerName,
    type: backup.mode, status: backup.status, progressPercent: backup.progressPercent,
    bytesProcessed: backup.bytesProcessed, totalBytes: backup.totalBytes,
    sizeBytes: backup.backupSizeBytes, createdAt: backup.requestedAt,
    startedAt: backup.startedAt, completedAt: backup.completedAt,
    errorMessage: backup.errorMessage,
    disks: backup.disks.map((disk) => ({ id: disk.id, label: disk.name, mountPoint: disk.letter })),
  };
}

type ApiGroup = {
  id: string; name: string; description: string | null; backupConfig: Group['backupSettings'];
  nextAutoRunAt: string | null;
  deviceCount: number; deviceIds: string[]; createdAt: string; updatedAt: string;
};
function mapGroup(group: ApiGroup): Group {
  return { ...group, backupSettings: group.backupConfig, nextAutoRunAt: group.nextAutoRunAt ?? null, devices: undefined };
}

export const api = {
  login: (username: 'admin' | 'user', password: string) =>
    request<{ token: string; role: 'admin' | 'user'; expiresIn: number }>('/auth/login', {
      method: 'POST', body: { username, password },
    }),
  getAgentInstaller: () => request<string>('/agents/installer'),
  getDashboard: async (): Promise<DashboardOverview> => {
    const summary = await request<{
      devices: { total: number; online: number; offline: number };
      backups: { total: number; active: number; failed: number };
      recentBackups: ApiBackup[];
      storage: {
        destination: string | null;
        available: boolean;
        totalBytes: number | null;
        freeBytes: number | null;
        secondary?: { destination: string | null; totalBytes: number | null; freeBytes: number | null } | null;
      };
      errors: Array<{ id: string; computerName: string; message: string; occurredAt: string }>;
      system: { status: string; database: string; checkedAt: string };
      notifications: Notification[];
      unreadNotifications: number;
    }>('/dashboard');
    return {
      stats: {
        devices: summary.devices.total, onlineDevices: summary.devices.online,
        offlineDevices: summary.devices.offline, backups: summary.backups.total,
        runningBackups: summary.backups.active,
      },
      recentBackups: summary.recentBackups.map(mapBackup),
      storage: {
        destination: summary.storage.destination, totalBytes: summary.storage.totalBytes ?? 0,
        freeBytes: summary.storage.freeBytes ?? 0,
        secondary: summary.storage.secondary ? {
          destination: summary.storage.secondary.destination,
          totalBytes: summary.storage.secondary.totalBytes ?? 0,
          freeBytes: summary.storage.secondary.freeBytes ?? 0,
          usedBytes: summary.storage.secondary.totalBytes !== null && summary.storage.secondary.freeBytes !== null
            ? summary.storage.secondary.totalBytes - summary.storage.secondary.freeBytes : 0,
        } : undefined,
        usedBytes: summary.storage.totalBytes !== null && summary.storage.freeBytes !== null
          ? summary.storage.totalBytes - summary.storage.freeBytes : 0,
      },
      errors: summary.errors.map((error) => ({
        id: error.id, title: error.computerName, message: error.message,
        createdAt: error.occurredAt, deviceName: error.computerName, severity: 'error',
      })),
      system: {
        status: summary.system.status === 'healthy' ? 'healthy'
          : summary.system.status === 'degraded' ? 'degraded' : 'unavailable',
        message: `${summary.system.database} · ${summary.system.checkedAt}`,
        serverTime: summary.system.checkedAt, version: 'LanVault',
      },
      notifications: summary.notifications ?? [],
      unreadNotifications: summary.unreadNotifications ?? 0,
    };
  },
  listDevices: async (params: { page: number; pageSize: number; search?: string; status?: string; approval?: string; groupId?: string }) => {
    const result = await paginated<ApiDevice>(`/devices${toQuery({ ...params, approvalStatus: params.approval, approval: undefined })}`);
    return { ...result, items: result.items.map(mapDevice) };
  },
  getDevice: async (id: string) => mapDevice(await request<ApiDevice>(`/devices/${encodeURIComponent(id)}`)),
  createDevice: async (input: DeviceInput) => mapDevice(await request<ApiDevice>('/devices', { method: 'POST', body: input })),
  updateDevice: async (id: string, input: Partial<DeviceInput>) => mapDevice(await request<ApiDevice>(`/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: input })),
  discoverDevices: async () => {
    const result = await request<PagePayload<ApiDevice>>('/devices/discover', { method: 'POST' });
    return { discovered: result.pagination.total, devices: result.data.map(mapDevice) };
  },
  approveDevice: async (id: string) => mapDevice(await request<ApiDevice>(`/devices/${encodeURIComponent(id)}/approve`, { method: 'POST' })),
  updateDeviceAgent: (id: string) => request<{ queued: boolean; alreadyQueued: boolean }>(`/devices/${encodeURIComponent(id)}/update-agent`, { method: 'POST' }),
  updateAllAgents: () => request<{ queued: string[]; skipped: Array<{ deviceId: string; reason: string }> }>('/devices/update-agents', { method: 'POST' }),
  rejectDevice: async (id: string) => mapDevice(await request<ApiDevice>(`/devices/${encodeURIComponent(id)}/reject`, { method: 'POST' })),
  revokeDevice: async (id: string) => mapDevice(await request<ApiDevice>(`/devices/${encodeURIComponent(id)}/unapprove`, { method: 'POST' })),
  deleteDevice: (id: string) => request<void>(`/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateDeviceDisks: async (id: string, disks: Array<{ id: string; isSelected: boolean }>) =>
    request<ApiDevice['disks']>(`/devices/${encodeURIComponent(id)}/disks`, { method: 'PUT', body: { disks } }),
  updateDeviceBackupExclusions: (id: string, excludedExtensions: string[], includedExtensions: string[]) =>
    request<ApiDevice>(`/devices/${encodeURIComponent(id)}/backup-exclusions`, {
      method: 'PUT', body: { excludedExtensions, includedExtensions },
    }).then(mapDevice),
  updateContinuousBackup: (id: string, enabled: boolean, intervalMinutes: number | null) =>
    request<ApiDevice>(`/devices/${encodeURIComponent(id)}/continuous-backup`, {
      method: 'PUT', body: { enabled, intervalMinutes },
    }).then(mapDevice),
  updateDeviceArchive: (id: string, mode: 'off' | 'zip', password?: string | null) =>
    request<ApiDevice>(`/devices/${encodeURIComponent(id)}/archive`, {
      method: 'PUT', body: { mode, password: password ?? null },
    }).then(mapDevice),

  listBackups: async (params: { page: number; pageSize: number; deviceId?: string; status?: string }) => {
    const result = await paginated<ApiBackup>(`/backups${toQuery(params)}`);
    return { ...result, items: result.items.map(mapBackup) };
  },
  listLatestBackups: async (params: { page: number; pageSize: number }) => {
    const result = await paginated<ApiBackup>(`/backups/latest${toQuery(params)}`);
    return { ...result, items: result.items.map(mapBackup) };
  },
  getBackupHistory: async (deviceId: string, params: { page: number; pageSize: number }) => {
    const result = await paginated<ApiBackup>(`/devices/${encodeURIComponent(deviceId)}/backups${toQuery(params)}`);
    return { ...result, items: result.items.map(mapBackup) };
  },
  getBackupLogs: (backupId: string, params: { page: number; pageSize: number }) =>
    paginated<BackupLog>(`/backups/${encodeURIComponent(backupId)}/logs${toQuery(params)}`),
  listDeletedFiles: (deviceId: string, params: { page: number; pageSize: number }) =>
    paginated<DeletedFile>(`/devices/${encodeURIComponent(deviceId)}/deleted-files${toQuery(params)}`),
  restoreDeletedFiles: (deviceId: string, fileIds: string[]) =>
    request<{ queued: number }>(`/devices/${encodeURIComponent(deviceId)}/deleted-files/restore`, { method: 'POST', body: { fileIds } }),
  listBackupTree: async (deviceId: string, backupId: string, params: { drive?: string; prefix?: string; page: number; pageSize: number }) => {    // NOTE: the response carries a top-level pagination object, so request()
    // returns the whole envelope — unwrap `data` explicitly.
    const result = await request<{ data: { drives: BackupTreeDrive[]; directories: string[]; files: BackupTreeFile[] }; pagination: { page: number; pageSize: number; total: number; totalPages: number } }>(
      `/devices/${encodeURIComponent(deviceId)}/backups/${encodeURIComponent(backupId)}/tree${toQuery(params)}`,
    );
    return { drives: result.data.drives ?? [], directories: result.data.directories ?? [], files: result.data.files ?? [], pagination: result.pagination };
  },
  listFileVersions: (deviceId: string, drive: string, path: string, params: { page: number; pageSize: number }) =>
    paginated<FileVersion>(`/devices/${encodeURIComponent(deviceId)}/file-versions${toQuery({ drive, path, ...params })}`),
  listBackupFiles: (deviceId: string, backupId: string, params: { search?: string; page: number; pageSize: number }) =>
    paginated<BackupTreeFile>(`/devices/${encodeURIComponent(deviceId)}/backups/${encodeURIComponent(backupId)}/files${toQuery(params)}`),
  restoreBackupFiles: (deviceId: string, items: RestoreBackupFileItem[]) =>
    request<{ queued: number }>(`/devices/${encodeURIComponent(deviceId)}/backup-files/restore`, { method: 'POST', body: { items } }),
  getProtectionSummary: (deviceId: string) =>
    request<ProtectionSummary>(`/devices/${encodeURIComponent(deviceId)}/protection`),
  startBackup: async (deviceId: string, mode: BackupKind) =>
    mapBackup(await request<ApiBackup>('/backups', { method: 'POST', body: { deviceId, mode } })),
  stopBackup: async (backupId: string) =>
    mapBackup(await request<ApiBackup>(`/backups/${encodeURIComponent(backupId)}/stop`, { method: 'POST' })),
  deleteBackup: (backupId: string) =>
    request<{ deleted: number }>(`/backups/${encodeURIComponent(backupId)}`, { method: 'DELETE' }),
  deleteAllBackups: () =>
    request<{ deleted: number; skipped: number }>('/backups', { method: 'DELETE' }),
  deleteDeviceBackups: (deviceId: string) =>
    request<{ deleted: number; skipped: number }>(`/devices/${encodeURIComponent(deviceId)}/backups`, { method: 'DELETE' }),
  clearBackupLogs: (backupId: string) =>
    request<{ deleted: number }>(`/backups/${encodeURIComponent(backupId)}/logs`, { method: 'DELETE' }),

  listGroups: async (params = { page: 1, pageSize: 100 }) => {
    const result = await paginated<ApiGroup>(`/groups${toQuery(params)}`);
    return { ...result, items: result.items.map(mapGroup) };
  },
  getGroup: async (id: string) => mapGroup(await request<ApiGroup>(`/groups/${encodeURIComponent(id)}`)),
  createGroup: async (input: GroupInput) => mapGroup(await request<ApiGroup>('/groups', { method: 'POST', body: {
    name: input.name, description: input.description, backupConfig: input.backupSettings,
  } })),
  updateGroup: async (id: string, input: GroupInput) => mapGroup(await request<ApiGroup>(`/groups/${encodeURIComponent(id)}`, { method: 'PUT', body: {
    name: input.name, description: input.description, backupConfig: input.backupSettings,
  } })),
  deleteGroup: (id: string) => request<void>(`/groups/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  setGroupDevices: async (groupId: string, deviceIds: string[]) => mapGroup(await request<ApiGroup>(`/groups/${encodeURIComponent(groupId)}/devices`, { method: 'PUT', body: { deviceIds } })),
  setGroupDevicesContinuous: (groupId: string, enabled: boolean) =>
    request<{ updated: number }>(`/groups/${encodeURIComponent(groupId)}/devices/continuous`, { method: 'PUT', body: { enabled } }),
  moveDeviceToGroup: async (deviceId: string, groupId: string | null) => mapDevice(await request<ApiDevice>(`/devices/${encodeURIComponent(deviceId)}`, { method: 'PATCH', body: { groupId } })),
  queueGroupBackups: (groupId: string, mode: BackupKind) => request<{ queued: Backup[]; skipped: Array<{ deviceId: string; reason: string }> }>(`/groups/${encodeURIComponent(groupId)}/backups`, { method: 'POST', body: { mode } }),

  getSettings: () => request<AppSettings>('/settings'),
  getAutoScheduleStatus: () => request<AutoScheduleStatus>('/settings/auto-schedule'),
  updateSettings: (settings: AppSettings) => request<AppSettings>('/settings', { method: 'PUT', body: settings }),
  checkStorage: (backup: AppSettings['backup']) => request<StorageCheckResult>('/settings/storage-check', { method: 'POST', body: { backup } }),
  getReplicationStatus: () => request<ReplicationStatus>('/settings/replication'),
  browseStorage: (path?: string) => request<StorageBrowseResult>(`/settings/storage-browse${toQuery({ path })}`),
  listSchedules: () => request<BackupSchedule[]>('/schedules'),
  createSchedule: (schedule: Omit<BackupSchedule, 'id' | 'lastRunAt' | 'nextRunAt' | 'lastRun' | 'createdAt' | 'updatedAt'>) =>
    request<BackupSchedule>('/schedules', { method: 'POST', body: schedule }),
  updateSchedule: (id: string, schedule: Omit<BackupSchedule, 'id' | 'lastRunAt' | 'nextRunAt' | 'lastRun' | 'createdAt' | 'updatedAt'>) =>
    request<BackupSchedule>(`/schedules/${encodeURIComponent(id)}`, { method: 'PUT', body: schedule }),
  deleteSchedule: (id: string) => request<void>(`/schedules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  listNotifications: (includeResolved = false, filters: { deviceId?: string; unassigned?: boolean } = {}) =>
    request<{ items: Notification[]; unread: number }>(`/notifications${toQuery({ includeResolved, deviceId: filters.deviceId, unassigned: filters.unassigned ? true : undefined })}`),
  markNotificationRead: (id: string) =>
    request<Notification>(`/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' }),
  deleteNotification: (id: string) =>
    request<void>(`/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  deleteAllNotifications: () =>
    request<{ deleted: number }>('/notifications', { method: 'DELETE' }),
  markAllNotificationsRead: () =>
    request<{ updated: number }>('/notifications/read-all', { method: 'POST' }),
  downloadAgentInstaller: async () => {
    const script = await request<string>('/agents/installer');
    const url = URL.createObjectURL(new Blob([script], { type: 'application/octet-stream' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'LanVault-Agent-Installer.bat';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};

export { apiBaseUrl };
