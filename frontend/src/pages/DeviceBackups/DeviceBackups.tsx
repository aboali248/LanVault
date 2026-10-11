import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import { useRealtime } from '../../hooks/useRealtime';
import type { Backup, BackupKind, Device, PaginationMeta, RealtimeEvent } from '../../types';
import { BackupHistory } from './BackupHistory';
import { BackupTable } from './BackupTable';
import { DeviceBackupTargets } from './DeviceBackupTargets';

const emptyPage: PaginationMeta = { page: 1, pageSize: 20, total: 0, totalPages: 0 };

interface BackupRealtimePayload {
  id: string;
  deviceId: string;
  mode?: BackupKind;
  type?: BackupKind;
  status: Backup['status'];
  progressPercent: number;
  bytesProcessed?: number | null;
  totalBytes?: number | null;
  backupSizeBytes?: number | null;
  sizeBytes?: number | null;
  startedAt?: string | null;
  completedAt?: string | null;
  createdAt?: string;
  errorMessage?: string | null;
}

function isBackupPayload(value: unknown): value is BackupRealtimePayload {
  return typeof value === 'object' && value !== null
    && typeof (value as { id?: unknown }).id === 'string'
    && typeof (value as { deviceId?: unknown }).deviceId === 'string';
}

export function DeviceBackups() {
  const { t } = useApp();
  const { notify } = useToast();
  const [backups, setBackups] = useState<Backup[]>([]);
  const [activeBackups, setActiveBackups] = useState<Backup[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [savingDiskDeviceId, setSavingDiskDeviceId] = useState<string>();
  const [pagination, setPagination] = useState(emptyPage);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [startingDeviceId, setStartingDeviceId] = useState<string>();
  const [togglingContinuousId, setTogglingContinuousId] = useState<string>();
  const [savingIntervalDeviceId, setSavingIntervalDeviceId] = useState<string>();
  const [defaultContinuousInterval, setDefaultContinuousInterval] = useState(5);
  const [deletingId, setDeletingId] = useState<string>();
  const [deletingAll, setDeletingAll] = useState(false);
  const [deletingDeviceHistory, setDeletingDeviceHistory] = useState(false);
  const [historyDevice, setHistoryDevice] = useState<{ id: string; name: string }>();
  const [history, setHistory] = useState<Backup[]>([]);
  const [historyPagination, setHistoryPagination] = useState<PaginationMeta>(emptyPage);
  const [historyPage, setHistoryPage] = useState(1);
  const mode: BackupKind = 'full';

  const refreshBackups = useCallback(async () => {
    const [backupPage, queuedPage, runningPage, stoppingPage] = await Promise.all([
      api.listLatestBackups({ page, pageSize: 20 }),
      api.listBackups({ page: 1, pageSize: 100, status: 'queued' }),
      api.listBackups({ page: 1, pageSize: 100, status: 'running' }),
      api.listBackups({ page: 1, pageSize: 100, status: 'cancel_requested' }),
    ]);
    setBackups(backupPage.items);
    setPagination(backupPage.pagination);
    setActiveBackups([...queuedPage.items, ...runningPage.items, ...stoppingPage.items]);
  }, [page]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [, devicePage, settings] = await Promise.all([
        refreshBackups(),
        api.listDevices({ page: 1, pageSize: 100, approval: 'approved' }),
        api.getSettings(),
      ]);
      setDevices(devicePage.items);
      setDefaultContinuousInterval(settings.backup.continuousBackupIntervalMinutes ?? 5);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t('actionFailed');
      setError(message); notify(message, 'error');
    } finally { setLoading(false); }
  }, [refreshBackups, notify, t]);
  useEffect(() => { void load(); }, [load]);

  // Live progress: patch only the affected backup row from realtime events —
  // no full reloads, so the page never refreshes on its own.
  const applyBackupEvent = useCallback((payload: BackupRealtimePayload) => {
    const patch: Partial<Backup> = {
      type: payload.type ?? payload.mode ?? 'incremental',
      status: payload.status,
      progressPercent: payload.progressPercent,
    };
    if (payload.bytesProcessed !== undefined) patch.bytesProcessed = payload.bytesProcessed;
    if (payload.totalBytes !== undefined) patch.totalBytes = payload.totalBytes;
    const size = payload.sizeBytes ?? payload.backupSizeBytes;
    if (size !== undefined) patch.sizeBytes = size;
    if (payload.startedAt !== undefined) patch.startedAt = payload.startedAt;
    if (payload.completedAt !== undefined) patch.completedAt = payload.completedAt;
    if (payload.errorMessage !== undefined) patch.errorMessage = payload.errorMessage;
    const terminal = ['completed', 'failed', 'cancelled'].includes(payload.status);
    const toRow = (fallbackName?: string): Backup => ({
      id: payload.id,
      deviceId: payload.deviceId,
      deviceName: fallbackName,
      type: patch.type ?? 'incremental',
      status: payload.status,
      progressPercent: payload.progressPercent ?? 0,
      bytesProcessed: payload.bytesProcessed ?? undefined,
      totalBytes: payload.totalBytes ?? undefined,
      sizeBytes: size ?? undefined,
      startedAt: payload.startedAt ?? undefined,
      completedAt: payload.completedAt ?? undefined,
      errorMessage: payload.errorMessage ?? undefined,
      createdAt: payload.createdAt,
    });
    setBackups((current) => {
      const index = current.findIndex((item) => item.id === payload.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = { ...next[index], ...patch };
        return next;
      }
      // A newly started run replaces its device's row (one operation per device).
      const deviceIndex = current.findIndex((item) => item.deviceId === payload.deviceId);
      if (deviceIndex >= 0 && !terminal) {
        const next = [...current];
        next[deviceIndex] = toRow(next[deviceIndex].deviceName);
        return next;
      }
      return current;
    });
    setActiveBackups((current) => {
      if (terminal) return current.filter((item) => item.id !== payload.id);
      const index = current.findIndex((item) => item.id === payload.id);
      if (index >= 0) {
        const next = [...current];
        next[index] = { ...next[index], ...patch };
        return next;
      }
      return [...current, toRow()];
    });
  }, []);
  useRealtime(useCallback((event: RealtimeEvent) => {
    if ((event.type === 'backup.progress' || event.type === 'backup.created') && isBackupPayload(event.payload)) {
      applyBackupEvent(event.payload);
    }
  }, [applyBackupEvent]));

  const start = async (device: Device) => {
    if (!device.disks.some((disk) => disk.selectedForBackup)) {
      notify(t('noDisksSelected'), 'error'); return;
    }
    if (savingDiskDeviceId === device.id) return;
    setStartingDeviceId(device.id);
    try { await api.startBackup(device.id, mode); notify(t('actionSuccess'), 'success'); await load(); }
    catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setStartingDeviceId(undefined); }
  };
  const toggleContinuous = async (device: Device) => {
    setTogglingContinuousId(device.id);
    try {
      const updated = await api.updateContinuousBackup(device.id, !device.continuousBackupEnabled, device.backupIntervalMinutes ?? null);
      setDevices((current) => current.map((item) => item.id === device.id ? { ...item, continuousBackupEnabled: updated.continuousBackupEnabled, backupIntervalMinutes: updated.backupIntervalMinutes } : item));
      notify(t('actionSuccess'), 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error');
    } finally {
      setTogglingContinuousId(undefined);
    }
  };
  const changeInterval = async (device: Device, intervalMinutes: number | null) => {
    setSavingIntervalDeviceId(device.id);
    try {
      const updated = await api.updateContinuousBackup(device.id, device.continuousBackupEnabled, intervalMinutes);
      setDevices((current) => current.map((item) => item.id === device.id ? { ...item, continuousBackupEnabled: updated.continuousBackupEnabled, backupIntervalMinutes: updated.backupIntervalMinutes } : item));
      notify(t('actionSuccess'), 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error');
    } finally {
      setSavingIntervalDeviceId(undefined);
    }
  };
  const toggleDisk = async (device: Device, diskId: string, selected: boolean) => {
    if (savingDiskDeviceId) return;
    setSavingDiskDeviceId(device.id);
    try {
      const disks = device.disks.map((disk) => ({
        id: disk.id,
        isSelected: disk.id === diskId ? selected : disk.selectedForBackup,
      }));
      await api.updateDeviceDisks(device.id, disks);
      setDevices((current) => current.map((item) => item.id === device.id
        ? {
          ...item,
          disks: item.disks.map((disk) => ({
            ...disk,
            selectedForBackup: disk.id === diskId ? selected : disk.selectedForBackup,
          })),
        }
        : item));
      notify(t('actionSuccess'), 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error');
    } finally {
      setSavingDiskDeviceId(undefined);
    }
  };
  const stop = async (backup: Backup) => {
    setBusyId(backup.id);
    try { await api.stopBackup(backup.id); notify(t('actionSuccess'), 'success'); await load(); }
    catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setBusyId(undefined); }
  };
  const removeBackup = async (backup: Backup) => {
    if (!window.confirm(t('deleteBackupQuestion'))) return;
    setDeletingId(backup.id);
    try {
      await api.deleteBackup(backup.id);
      notify(t('actionSuccess'), 'success');
      await load();
      if (historyDevice && backup.deviceId === historyDevice.id) await loadHistory();
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setDeletingId(undefined); }
  };
  const removeAllBackups = async () => {
    if (!window.confirm(t('deleteAllBackupsQuestion'))) return;
    setDeletingAll(true);
    try {
      const result = await api.deleteAllBackups();
      notify(result.skipped ? t('deleteSkippedActive') : t('actionSuccess'), result.skipped ? 'error' : 'success');
      await load();
      if (historyDevice) await loadHistory();
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setDeletingAll(false); }
  };
  const removeDeviceHistory = async () => {
    if (!historyDevice || !window.confirm(t('deleteDeviceHistoryQuestion'))) return;
    setDeletingDeviceHistory(true);
    try {
      const result = await api.deleteDeviceBackups(historyDevice.id);
      notify(result.skipped ? t('deleteSkippedActive') : t('actionSuccess'), result.skipped ? 'error' : 'success');
      await load();
      await loadHistory();
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setDeletingDeviceHistory(false); }
  };
  const openHistory = (backup: Backup) => {
    setHistoryPage(1);
    setHistoryDevice({ id: backup.deviceId, name: backup.deviceName ?? backup.deviceId });
  };
  const loadHistory = useCallback(async () => {
    if (!historyDevice) return;
    try {
      const result = await api.getBackupHistory(historyDevice.id, { page: historyPage, pageSize: 20 });
      setHistory(result.items); setHistoryPagination(result.pagination);
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
  }, [historyDevice, historyPage, notify, t]);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  return <>
    <PageHeader icon="backups" title={t('backups')} description={t('backupManagement')} actions={<>
        <Button variant="outline" icon="trash" className="text-rose-600" onClick={() => void removeAllBackups()} loading={deletingAll}>{t('deleteAllBackups')}</Button>
        <Button variant="outline" icon="refresh" onClick={() => void load()} loading={loading}>{t('refresh')}</Button>
      </>} />
    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('backups')}>
      {[
        { label: t('currentPageSummary'), value: backups.length, icon: 'backups' as const, tone: 'text-sky-600 bg-sky-500/10' },
        { label: t('backupActiveCount'), value: backups.filter((backup) => ['queued', 'running', 'cancel_requested'].includes(backup.status)).length, icon: 'refresh' as const, tone: 'text-orange-600 bg-orange-500/10' },
        { label: t('backupCompletedCount'), value: backups.filter((backup) => backup.status === 'completed').length, icon: 'check' as const, tone: 'text-emerald-600 bg-emerald-500/10' },
        { label: t('backupFailedCount'), value: backups.filter((backup) => backup.status === 'failed').length, icon: 'alert' as const, tone: 'text-rose-600 bg-rose-500/10' },
      ].map((item) => <article key={item.label} className="surface flex items-center gap-3 p-3.5">
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${item.tone}`}><Icon name={item.icon} size={19} /></span>
        <div><p className="text-xs text-slate-500">{item.label}</p><p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">{item.value}</p></div>
      </article>)}
    </section>
    <section className="surface mb-5 overflow-hidden">
      <header className="flex items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-5">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-500/10 text-orange-600"><Icon name="sliders" size={18} /></span>
        <div className="min-w-0 flex-1"><h2 className="text-sm font-bold text-slate-900 dark:text-white">{t('backupConfiguration')}</h2><p className="mt-0.5 text-xs text-slate-500">{t('backupTargetsHint')}</p></div>
      </header>
      <DeviceBackupTargets devices={devices} backups={activeBackups} mode={mode} loading={loading} startingDeviceId={startingDeviceId}
        savingDiskDeviceId={savingDiskDeviceId} stoppingBackupId={busyId} togglingContinuousId={togglingContinuousId} savingIntervalDeviceId={savingIntervalDeviceId} defaultIntervalMinutes={defaultContinuousInterval} onStart={(device) => void start(device)}
        onStop={(backup) => void stop(backup)} onToggleContinuous={(device) => void toggleContinuous(device)}
        onIntervalChange={(device, minutes) => void changeInterval(device, minutes)}
        onToggleDisk={(device, diskId, selected) => void toggleDisk(device, diskId, selected)} />
    </section>
    {error && <div role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error}<Button variant="ghost" onClick={() => void load()}>{t('retry')}</Button></div>}
    {loading && <div className="surface mb-3 p-4 text-sm text-slate-500">{t('loading')}</div>}
    <BackupTable backups={backups} pagination={pagination} onPage={setPage} onStop={(backup) => void stop(backup)} onHistory={(backup) => openHistory(backup)} onDelete={(backup) => void removeBackup(backup)} busyId={busyId} deletingId={deletingId} />
    <Modal open={Boolean(historyDevice)} onClose={() => setHistoryDevice(undefined)} title={`${t('backupHistory')} · ${historyDevice?.name ?? ''}`} size="lg">
      <div className="mb-4 flex justify-end">
        <Button variant="outline" icon="trash" className="min-h-9 px-3 text-xs text-rose-600" loading={deletingDeviceHistory} onClick={() => void removeDeviceHistory()}>{t('deleteDeviceHistory')}</Button>
      </div>
      <BackupHistory backups={history} pagination={historyPagination} onPage={setHistoryPage} onDelete={(backup) => void removeBackup(backup)} deletingId={deletingId} />
    </Modal>
  </>;
}
