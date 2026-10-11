export type Language = 'ar' | 'en';
export type Theme = 'light' | 'dark';
export type ConnectionState = 'connecting' | 'connected' | 'disconnected';
export type DeviceState = 'online' | 'offline' | 'busy' | 'error' | 'unknown';
export type AgentState = 'connected' | 'disconnected' | 'pending' | 'inactive' | 'error' | 'needs_update' | 'unknown';
export type BackupKind = 'full' | 'incremental';
export type BackupState = 'queued' | 'running' | 'completed' | 'failed' | 'stopped' | 'cancelled' | 'cancel_requested';

export interface ApiErrorBody {
  message?: string;
  error?: string;
  details?: Record<string, string[]> | string[];
}

export interface ApiEnvelope<T> {
  data: T;
  message?: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

export interface Disk {
  id: string;
  deviceId?: string;
  label: string;
  mountPoint: string | null;
  filesystem?: string;
  totalBytes: number;
  freeBytes: number;
  selectedForBackup: boolean;
}

export interface GroupSummary {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
}

export interface Device {
  id: string;
  computerName: string;
  windowsUsername?: string | null;
  ipAddress?: string | null;
  macAddress?: string | null;
  operatingSystem?: string | null;
  agentVersion?: string | null;
  latestAgentVersion?: string | null;
  agentBuildHash?: string | null;
  agentUpdateAvailable?: boolean;
  agentUpdateStatus?: 'queued' | 'downloading' | 'installing' | 'failed' | 'current' | null;
  agentUpdateError?: string | null;
  backupExcludedExtensions: string[];
  backupIncludedExtensions: string[];
  continuousBackupEnabled: boolean;
  backupIntervalMinutes: number | null;
  archiveMode: 'off' | 'zip';
  hasArchivePassword: boolean;
  status: DeviceState;
  agentStatus: AgentState;
  approved: boolean;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  groupId?: string | null;
  group?: GroupSummary | null;
  disks: Disk[];
  lastSeenAt?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface Backup {
  id: string;
  deviceId: string;
  deviceName?: string;
  type: BackupKind;
  status: BackupState;
  progressPercent: number;
  bytesProcessed?: number | null;
  totalBytes?: number | null;
  sizeBytes?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  errorMessage?: string | null;
  disks?: Array<string | { id: string; label: string; mountPoint?: string | null }>;
  createdAt?: string;
}

export interface BackupLog {
  id: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  createdAt: string;
}

export interface DeletedFile {
  id: string;
  deviceId: string;
  drive: string;
  relativePath: string;
  sourceBackupId: string;
  detectedAt: string;
  restoreStatus: 'deleted' | 'failed' | 'queued' | 'restored';
  restoreError: string | null;
}

export interface BackupTreeDrive {
  drive: string;
  fileCount: number;
}

export interface BackupTreeFile {
  drive: string;
  relativePath: string;
  name: string;
  sizeBytes: number;
  sha256: string;
  lastWriteTicks: string;
}

export interface FileVersion {
  backupId: string;
  drive: string;
  relativePath: string;
  sizeBytes: number;
  sha256: string;
  lastWriteTicks: string;
  mode: BackupKind;
  status: string;
  requestedAt: string;
  completedAt: string | null;
}

export interface RestoreBackupFileItem {
  backupId: string;
  drive: string;
  relativePath?: string;
  prefix?: string;
}

export interface ProtectionSummary {
  protectedFiles: number;
  lastCompletedAt: string | null;
  lastStatus: string | null;
  queuedRestores: number;
}

export interface Group {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  deviceCount?: number;
  devices?: Device[];
  backupSettings?: GroupBackupSettings | null;
  nextAutoRunAt?: string | null;
  deviceIds?: string[];
  createdAt?: string;
  updatedAt?: string;
}

export interface GroupBackupSettings {
  retentionCount?: number;
  maxTransferMbps?: number | null;
  defaultBackupType?: BackupKind;
  backupWindow?: {
    start: string;
    end: string;
    days: number[];
    lastRunAt: string | null;
  } | null;
}

export interface DashboardStats {
  devices: number;
  onlineDevices: number;
  offlineDevices: number;
  backups: number;
  runningBackups: number;
}

export interface StorageStatus {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  destination?: string | null;
  secondary?: Omit<StorageStatus, 'secondary'>;
}

export interface StorageDestinationCheck {
  path: string | null;
  configured: boolean;
  available: boolean;
  writable: boolean;
  totalBytes: number | null;
  freeBytes: number | null;
  freePercent: number | null;
  error: string | null;
}

export interface StorageCheckResult {
  primary: StorageDestinationCheck;
  secondary: StorageDestinationCheck;
  checkedAt: string;
}

export interface ReplicationStatus {
  secondaryConfigured: boolean;
  pending: number;
  failed: number;
  checkedAt: string;
}

export interface StorageBrowseResult {
  path: string | null;
  parentPath: string | null;
  roots: string[];
  directories: string[];
  hasMore: boolean;
}

export interface SystemStatus {
  status: 'healthy' | 'degraded' | 'unavailable' | 'unknown';
  message?: string | null;
  version?: string | null;
  serverTime?: string | null;
}

export interface SystemError {
  id: string;
  title: string;
  message: string;
  createdAt?: string | null;
  deviceName?: string | null;
  severity?: 'info' | 'warning' | 'error';
}

export interface DashboardOverview {
  stats: DashboardStats;
  recentBackups: Backup[];
  storage: StorageStatus;
  errors: SystemError[];
  system: SystemStatus;
  notifications: Notification[];
  unreadNotifications: number;
}

export interface ServerSettings { host: string; port: number; }
export interface NetworkSettings { advertisedAddress: string | null; }
export interface BackupSettings {
  destination: string | null;
  secondaryDestination: string | null;
  maxTransferRateMbps: number | null;
  retentionCount: number | null;
  lowSpaceThresholdPercent: number;
  excludedExtensions: string[];
  continuousBackupIntervalMinutes: number;
  autoSchedule: AutoScheduleConfig;
}

export interface AutoScheduleConfig {
  enabled: boolean;
  timeOfDay: string;
  frequency: 'daily' | 'weekly';
  dayOfWeek: number | null;
  mode: BackupKind;
  retentionCount: number | null;
  lastRunAt: string | null;
}

export interface AutoScheduleStatus {
  config: AutoScheduleConfig;
  nextRunAt: string | null;
  lastRun: { backupId: string; status: string; requestedAt: string } | null;
}
export interface AgentSettings { heartbeatTimeoutSeconds: number; }

export interface BackupSchedule {
  id: string;
  name: string;
  targetType: 'device' | 'group';
  targetId: string;
  frequency: 'daily' | 'weekly';
  dayOfWeek: number | null;
  timeOfDay: string;
  mode: BackupKind;
  retentionCount: number | null;
  enabled: boolean;
  windowStart: string | null;
  windowEnd: string | null;
  repeatIntervalMinutes: number | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastRun: { backupId: string; status: string; requestedAt: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Notification {
  id: string;
  type: 'agent_offline' | 'backup_failed' | 'storage_low' | 'storage_unavailable' | 'files_deleted' | 'schedule_failed';
  sourceKey: string;
  deviceId: string | null;
  title: string;
  message: string;
  severity: 'warning' | 'error';
  createdAt: string;
  readAt: string | null;
  resolvedAt: string | null;
}

export interface AppSettings {
  server: ServerSettings;
  network: NetworkSettings;
  backup: BackupSettings;
  agent: AgentSettings;
  interface: { language: Language; theme: Theme | 'system' };
}

export interface DeviceInput {
  computerName: string;
  ipAddress?: string;
  windowsUsername?: string;
  macAddress?: string;
  operatingSystem?: string;
  groupId?: string | null;
}

export interface GroupInput {
  name: string;
  description?: string;
  color?: string;
  backupSettings?: GroupBackupSettings;
}

export interface RealtimeEvent {
  type: string;
  payload: unknown;
}

export interface BackupProgressEvent {
  backupId: string;
  deviceId?: string;
  progressPercent: number;
  bytesProcessed?: number;
  totalBytes?: number;
  status?: BackupState;
  errorMessage?: string | null;
}

export interface DeviceStatusEvent {
  deviceId: string;
  status: DeviceState;
  agentStatus?: AgentState;
  lastSeenAt?: string;
}
