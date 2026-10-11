export type ApprovalStatus = "pending" | "approved" | "rejected";
export type DeviceStatus = "online" | "offline" | "busy" | "error";
export type AgentStatus = "registered" | "online" | "offline" | "error" | "needs_update";
export type BackupMode = "full" | "incremental";
export type BackupStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled";
export type CommandType = "backup" | "stop_backup" | "restore_file";
export type CommandStatus = "pending" | "delivered" | "acknowledged" | "completed" | "cancelled";

export interface DiskInput {
  id: string;
  name: string;
  letter?: string | null;
  fileSystem?: string | null;
  totalBytes?: number | null;
  freeBytes?: number | null;
}

export interface DeviceRow {
  id: string;
  computer_name: string;
  windows_username: string | null;
  ip_address: string | null;
  mac_address: string | null;
  operating_system: string | null;
  approval_status: ApprovalStatus;
  status: DeviceStatus;
  agent_status: AgentStatus;
  agent_token_hash: string | null;
  agent_version: string | null;
  agent_build_hash: string | null;
  agent_update_status: "queued" | "downloading" | "installing" | "failed" | "current" | null;
  agent_update_error: string | null;
  backup_excluded_extensions: string;
  backup_included_extensions: string;
  archive_mode: "off" | "zip";
  archive_password: string | null;
  continuous_backup_enabled: number;
  backup_interval_minutes: number | null;
  continuous_backup_next_run_at: string | null;
  last_seen_at: string | null;
  group_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiskRow {
  id: string;
  device_id: string;
  disk_key: string;
  name: string;
  letter: string | null;
  file_system: string | null;
  total_bytes: number | null;
  free_bytes: number | null;
  is_selected: number;
  created_at: string;
  updated_at: string;
}

export interface BackupRow {
  id: string;
  device_id: string;
  mode: BackupMode;
  status: BackupStatus;
  progress_percent: number;
  bytes_processed: number;
  total_bytes: number | null;
  backup_size_bytes: number | null;
  destination: string | null;
  disks_snapshot: string;
  requested_by: string | null;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}
