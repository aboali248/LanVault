import type Database from "better-sqlite3";

interface Migration {
  version: number;
  name: string;
  sql: string;
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_lanvault_schema",
    sql: `
      CREATE TABLE IF NOT EXISTS groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL COLLATE NOCASE UNIQUE,
        description TEXT,
        backup_config TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS devices (
        id TEXT PRIMARY KEY,
        computer_name TEXT NOT NULL,
        windows_username TEXT,
        ip_address TEXT,
        mac_address TEXT COLLATE NOCASE UNIQUE,
        operating_system TEXT,
        approval_status TEXT NOT NULL CHECK (approval_status IN ('pending', 'approved', 'rejected')) DEFAULT 'pending',
        status TEXT NOT NULL CHECK (status IN ('online', 'offline', 'busy', 'error')) DEFAULT 'offline',
        agent_status TEXT NOT NULL CHECK (agent_status IN ('registered', 'online', 'offline', 'error', 'needs_update')) DEFAULT 'offline',
        agent_token_hash TEXT,
        agent_version TEXT,
        last_seen_at TEXT,
        group_id TEXT REFERENCES groups(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_devices_group_id ON devices(group_id);
      CREATE INDEX IF NOT EXISTS idx_devices_approval_status ON devices(approval_status);
      CREATE INDEX IF NOT EXISTS idx_devices_last_seen_at ON devices(last_seen_at);

      CREATE TABLE IF NOT EXISTS disks (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        disk_key TEXT NOT NULL,
        name TEXT NOT NULL,
        letter TEXT,
        file_system TEXT,
        total_bytes INTEGER,
        free_bytes INTEGER,
        is_selected INTEGER NOT NULL CHECK (is_selected IN (0, 1)) DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(device_id, disk_key)
      );

      CREATE INDEX IF NOT EXISTS idx_disks_device_id ON disks(device_id);

      CREATE TABLE IF NOT EXISTS backups (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        mode TEXT NOT NULL CHECK (mode IN ('full', 'incremental')),
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancel_requested', 'cancelled')) DEFAULT 'queued',
        progress_percent REAL NOT NULL DEFAULT 0 CHECK (progress_percent >= 0 AND progress_percent <= 100),
        bytes_processed INTEGER NOT NULL DEFAULT 0,
        total_bytes INTEGER,
        backup_size_bytes INTEGER,
        destination TEXT,
        disks_snapshot TEXT NOT NULL,
        requested_by TEXT,
        requested_at TEXT NOT NULL,
        started_at TEXT,
        completed_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_backups_device_requested_at ON backups(device_id, requested_at DESC);
      CREATE INDEX IF NOT EXISTS idx_backups_status ON backups(status);

      CREATE TABLE IF NOT EXISTS backup_logs (
        id TEXT PRIMARY KEY,
        backup_id TEXT NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK (level IN ('info', 'warning', 'error')),
        message TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_backup_logs_backup_id ON backup_logs(backup_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS agent_commands (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        backup_id TEXT REFERENCES backups(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('backup', 'stop_backup')),
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'acknowledged', 'completed', 'cancelled')) DEFAULT 'pending',
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        acknowledged_at TEXT,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_agent_commands_device_status ON agent_commands(device_id, status, created_at);

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    name: "schedules_alerts_and_secondary_storage",
    sql: `
      CREATE TABLE backup_schedules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('device', 'group')),
        target_id TEXT NOT NULL,
        frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly')),
        day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
        time_of_day TEXT NOT NULL CHECK (time_of_day GLOB '[0-2][0-9]:[0-5][0-9]'),
        mode TEXT NOT NULL CHECK (mode IN ('full', 'incremental')),
        retention_count INTEGER CHECK (retention_count BETWEEN 1 AND 1000),
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        last_run_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX idx_backup_schedules_enabled ON backup_schedules(enabled, time_of_day);

      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('agent_offline', 'backup_failed', 'storage_low', 'storage_unavailable')),
        source_key TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
        created_at TEXT NOT NULL,
        read_at TEXT,
        resolved_at TEXT
      );
      CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
      CREATE INDEX idx_notifications_source ON notifications(type, source_key, resolved_at);
    `,
  },
  {
    version: 3,
    name: "backup_file_inventory_and_restore_commands",
    sql: `
      ALTER TABLE agent_commands RENAME TO agent_commands_v2;
      CREATE TABLE agent_commands (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        backup_id TEXT REFERENCES backups(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('backup', 'stop_backup', 'restore_file')),
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'acknowledged', 'completed', 'cancelled')) DEFAULT 'pending',
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        acknowledged_at TEXT,
        completed_at TEXT
      );
      INSERT INTO agent_commands SELECT * FROM agent_commands_v2;
      DROP TABLE agent_commands_v2;
      CREATE INDEX idx_agent_commands_device_status ON agent_commands(device_id, status, created_at);

      CREATE TABLE backup_files (
        backup_id TEXT NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        drive TEXT NOT NULL,
        relative_path TEXT NOT NULL COLLATE NOCASE,
        size_bytes INTEGER NOT NULL,
        last_write_ticks INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (backup_id, drive, relative_path)
      );
      CREATE INDEX idx_backup_files_device_path ON backup_files(device_id, drive, relative_path, created_at DESC);
      CREATE INDEX idx_backup_files_hash ON backup_files(device_id, drive, relative_path, sha256);

      CREATE TABLE deleted_files (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        drive TEXT NOT NULL,
        relative_path TEXT NOT NULL COLLATE NOCASE,
        source_backup_id TEXT NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
        detected_at TEXT NOT NULL,
        restore_status TEXT NOT NULL CHECK (restore_status IN ('deleted', 'queued', 'restored', 'failed')) DEFAULT 'deleted',
        restore_error TEXT,
        restored_at TEXT,
        UNIQUE (device_id, drive, relative_path)
      );
      CREATE INDEX idx_deleted_files_device_status ON deleted_files(device_id, restore_status, detected_at DESC);
    `,
  },
  {
    version: 4,
    name: "deleted_file_notifications",
    sql: `
      ALTER TABLE notifications RENAME TO notifications_v3;
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('agent_offline', 'backup_failed', 'storage_low', 'storage_unavailable', 'files_deleted')),
        source_key TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
        created_at TEXT NOT NULL,
        read_at TEXT,
        resolved_at TEXT
      );
      INSERT INTO notifications SELECT * FROM notifications_v3;
      DROP TABLE notifications_v3;
      CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
      CREATE INDEX idx_notifications_source ON notifications(type, source_key, resolved_at);
    `,
  },
  {
    version: 5,
    name: "agent_build_tracking_and_update_commands",
    sql: `
      ALTER TABLE devices ADD COLUMN agent_build_hash TEXT;

      ALTER TABLE agent_commands RENAME TO agent_commands_v4;
      CREATE TABLE agent_commands (
        id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        backup_id TEXT REFERENCES backups(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('backup', 'stop_backup', 'restore_file', 'update_agent')),
        payload TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'acknowledged', 'completed', 'cancelled')) DEFAULT 'pending',
        created_at TEXT NOT NULL,
        delivered_at TEXT,
        acknowledged_at TEXT,
        completed_at TEXT
      );
      INSERT INTO agent_commands SELECT * FROM agent_commands_v4;
      DROP TABLE agent_commands_v4;
      CREATE INDEX idx_agent_commands_device_status ON agent_commands(device_id, status, created_at);
    `,
  },
  {
    version: 6,
    name: "agent_update_progress",
    sql: `
      ALTER TABLE devices ADD COLUMN agent_update_status TEXT
        CHECK (agent_update_status IN ('queued', 'downloading', 'installing', 'failed', 'current'));
      ALTER TABLE devices ADD COLUMN agent_update_error TEXT;
    `,
  },
  {
    version: 7,
    name: "backup_file_extension_exclusions",
    sql: `
      ALTER TABLE devices ADD COLUMN backup_excluded_extensions TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE devices ADD COLUMN backup_included_extensions TEXT NOT NULL DEFAULT '[]';
    `,
  },
  {
    version: 8,
    name: "continuous_backup_configuration",
    sql: `
      ALTER TABLE devices ADD COLUMN continuous_backup_enabled INTEGER NOT NULL DEFAULT 0 CHECK (continuous_backup_enabled IN (0, 1));
      ALTER TABLE devices ADD COLUMN backup_interval_minutes INTEGER CHECK (backup_interval_minutes BETWEEN 1 AND 1440);
      ALTER TABLE devices ADD COLUMN continuous_backup_next_run_at TEXT;
    `,
  },
  {
    version: 9,
    name: "schedule_repeat_windows",
    sql: `
      ALTER TABLE backup_schedules ADD COLUMN window_start TEXT;
      ALTER TABLE backup_schedules ADD COLUMN window_end TEXT;
      ALTER TABLE backup_schedules ADD COLUMN repeat_interval_minutes INTEGER CHECK (repeat_interval_minutes BETWEEN 5 AND 1440);
    `,
  },
  {
    version: 10,
    name: "change_based_backups_current_state",
    sql: `
      CREATE TABLE file_current (
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        drive TEXT NOT NULL,
        relative_path TEXT NOT NULL COLLATE NOCASE,
        backup_id TEXT NOT NULL REFERENCES backups(id) ON DELETE CASCADE,
        size_bytes INTEGER NOT NULL,
        last_write_ticks INTEGER NOT NULL,
        sha256 TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (device_id, drive, relative_path)
      );
      CREATE INDEX idx_file_current_backup ON file_current(device_id, backup_id);
      INSERT INTO file_current (device_id, drive, relative_path, backup_id, size_bytes, last_write_ticks, sha256, updated_at)
      SELECT device_id, drive, relative_path, backup_id, size_bytes, last_write_ticks, sha256, created_at FROM (
        SELECT device_id, drive, relative_path, backup_id, size_bytes, last_write_ticks, sha256, created_at,
          ROW_NUMBER() OVER (PARTITION BY device_id, drive, relative_path ORDER BY created_at DESC) AS rn
        FROM backup_files
      ) WHERE rn = 1;
      ALTER TABLE deleted_files ADD COLUMN size_bytes INTEGER;
      ALTER TABLE deleted_files ADD COLUMN sha256 TEXT;
      UPDATE deleted_files SET size_bytes = (
        SELECT f.size_bytes FROM backup_files f
        WHERE f.backup_id = deleted_files.source_backup_id AND f.device_id = deleted_files.device_id
          AND f.drive = deleted_files.drive AND f.relative_path = deleted_files.relative_path COLLATE NOCASE
      ), sha256 = (
        SELECT f.sha256 FROM backup_files f
        WHERE f.backup_id = deleted_files.source_backup_id AND f.device_id = deleted_files.device_id
          AND f.drive = deleted_files.drive AND f.relative_path = deleted_files.relative_path COLLATE NOCASE
      );
    `,
  },
  {
    version: 11,
    name: "schedule_failure_notifications",
    sql: `
      ALTER TABLE notifications RENAME TO notifications_v10;
      CREATE TABLE notifications (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL CHECK (type IN ('agent_offline', 'backup_failed', 'storage_low', 'storage_unavailable', 'files_deleted', 'schedule_failed')),
        source_key TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        severity TEXT NOT NULL CHECK (severity IN ('warning', 'error')),
        created_at TEXT NOT NULL,
        read_at TEXT,
        resolved_at TEXT
      );
      INSERT INTO notifications SELECT * FROM notifications_v10;
      DROP TABLE notifications_v10;
      CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
      CREATE INDEX idx_notifications_source ON notifications(type, source_key, resolved_at);
    `,
  },
  {
    version: 12,
    name: "content_hash_indexes_for_shared_store",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_backup_files_sha ON backup_files(sha256);
      CREATE INDEX IF NOT EXISTS idx_file_current_sha ON file_current(sha256);
      CREATE INDEX IF NOT EXISTS idx_deleted_files_sha ON deleted_files(sha256);
    `,
  },
  {
    version: 13,
    name: "notification_device_link",
    sql: `
      ALTER TABLE notifications ADD COLUMN device_id TEXT REFERENCES devices(id) ON DELETE SET NULL;
      CREATE INDEX IF NOT EXISTS idx_notifications_device ON notifications(device_id, created_at DESC);
      UPDATE notifications SET device_id = source_key
      WHERE type = 'agent_offline' AND EXISTS (SELECT 1 FROM devices WHERE devices.id = notifications.source_key);
    `,
  },
  {
    version: 14,
    name: "per_device_archive_storage",
    sql: `
      ALTER TABLE devices ADD COLUMN archive_mode TEXT NOT NULL DEFAULT 'off'
        CHECK (archive_mode IN ('off', 'zip'));
      ALTER TABLE devices ADD COLUMN archive_password TEXT;
    `,
  },
  {
    version: 15,
    name: "server_side_secondary_replication",
    sql: `
      CREATE TABLE IF NOT EXISTS replication_queue (
        id TEXT PRIMARY KEY,
        backup_id TEXT REFERENCES backups(id) ON DELETE CASCADE,
        device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
        sha256 TEXT NOT NULL,
        size_bytes INTEGER,
        primary_destination TEXT NOT NULL,
        secondary_destination TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending'
          CHECK (status IN ('pending', 'copying', 'done', 'failed')),
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (backup_id, sha256)
      );
      CREATE INDEX IF NOT EXISTS idx_replication_queue_status
        ON replication_queue(status, created_at);
    `,
  },
];

export function runMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);

  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => Number((row as { version: number }).version)),
  );
  const applyMigration = db.transaction((migration: Migration) => {
    db.exec(migration.sql);
    db.prepare("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)")
      .run(migration.version, migration.name, new Date().toISOString());
  });

  for (const migration of migrations) {
    if (!applied.has(migration.version)) applyMigration(migration);
  }
}
