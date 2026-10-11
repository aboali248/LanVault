import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import type { Backup, BackupTreeFile, Device, FileVersion, ProtectionSummary } from '../../types';
import { formatBytes, formatDate } from '../../utils/format';

const pageSize = 50;

export function Browse() {
  const { language, t } = useApp();
  const { notify } = useToast();
  const ar = language === 'ar';
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [backups, setBackups] = useState<Backup[]>([]);
  const [backupId, setBackupId] = useState('');
  const [drives, setDrives] = useState<Array<{ drive: string; fileCount: number }>>([]);
  const [drive, setDrive] = useState('');
  const [segments, setSegments] = useState<string[]>([]);
  const [directories, setDirectories] = useState<string[]>([]);
  const [files, setFiles] = useState<BackupTreeFile[]>([]);
  const [totalFiles, setTotalFiles] = useState(0);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingTree, setLoadingTree] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [versionsFile, setVersionsFile] = useState<BackupTreeFile | null>(null);
  const [versions, setVersions] = useState<FileVersion[]>([]);
  const [versionsTotal, setVersionsTotal] = useState(0);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [restoringVersion, setRestoringVersion] = useState('');
  const [protection, setProtection] = useState<ProtectionSummary | null>(null);

  const selectedBackup = backups.find((backup) => backup.id === backupId);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try {
      const [deviceResult] = await Promise.all([
        api.listDevices({ page: 1, pageSize: 100, approval: 'approved' }),
      ]);
      setDevices(deviceResult.items);
      setDeviceId((current) => current && deviceResult.items.some((device) => device.id === current)
        ? current : deviceResult.items[0]?.id ?? '');
    } catch (error) {
      notify(error instanceof Error ? error.message : t('actionFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [notify, t]);

  useEffect(() => { void loadDevices(); }, [loadDevices]);

  const loadBackups = useCallback(async () => {
    if (!deviceId) { setBackups([]); setBackupId(''); setProtection(null); return; }
    try {
      const [history, summary] = await Promise.all([
        api.getBackupHistory(deviceId, { page: 1, pageSize: 20 }),
        api.getProtectionSummary(deviceId),
      ]);
      setBackups(history.items);
      setProtection(summary);
      setBackupId((current) => current && history.items.some((backup) => backup.id === current)
        ? current : history.items[0]?.id ?? '');
    } catch (error) {
      notify(error instanceof Error ? error.message : t('actionFailed'), 'error');
    }
  }, [deviceId, notify, t]);

  useEffect(() => { void loadBackups(); }, [loadBackups]);

  const loadTree = useCallback(async () => {
    if (!deviceId || !backupId) { setDrives([]); setDirectories([]); setFiles([]); return; }
    setLoadingTree(true);
    try {
      const result = await api.listBackupTree(deviceId, backupId, {
        drive: drive || undefined,
        prefix: segments.join('/') || undefined,
        page,
        pageSize,
      });
      setDrives(result.drives);
      setDirectories(result.directories);
      setFiles(result.files);
      setTotalFiles(result.pagination.total);
      setTotalPages(Math.max(1, result.pagination.totalPages));
      setSelected([]);
      if (drive && !result.drives.some((entry) => entry.drive === drive)) setDrive('');
    } catch (error) {
      notify(error instanceof Error ? error.message : t('actionFailed'), 'error');
    } finally {
      setLoadingTree(false);
    }
  }, [deviceId, backupId, drive, segments, page, notify, t]);

  useEffect(() => { void loadTree(); }, [loadTree]);

  const pickDevice = (id: string) => {
    setDeviceId(id); setBackupId(''); setDrive(''); setSegments([]); setPage(1); setSelected([]);
  };
  const pickBackup = (id: string) => {
    setBackupId(id); setDrive(''); setSegments([]); setPage(1); setSelected([]);
  };
  const pickDrive = (value: string) => {
    setDrive(value); setSegments([]); setPage(1); setSelected([]);
  };
  const openFolder = (name: string) => {
    setSegments((current) => [...current, name]); setPage(1); setSelected([]);
  };

  const visibleFiles = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return files;
    return files.filter((file) => file.name.toLocaleLowerCase().includes(query));
  }, [files, search]);

  const toggle = (relativePath: string) => setSelected((current) => current.includes(relativePath)
    ? current.filter((item) => item !== relativePath)
    : [...current, relativePath]);

  const restoreSelected = async () => {
    if (!deviceId || !backupId || !selected.length) return;
    setRestoring(true);
    try {
      const result = await api.restoreBackupFiles(deviceId, selected.map((relativePath) => ({
        backupId, drive, relativePath,
      })));
      notify(ar ? `تم إرسال ${result.queued} ملف للاستعادة. سيعيد الجهاز الملفات عند اتصاله.` : `${result.queued} file(s) queued for restore. The device will restore them when it connects.`, 'success');
      setSelected([]);
    } catch (error) {
      notify(error instanceof Error ? error.message : t('actionFailed'), 'error');
    } finally {
      setRestoring(false);
    }
  };

  const restoreFolder = async () => {
    if (!deviceId || !backupId || !drive) return;
    setRestoring(true);
    try {
      const result = await api.restoreBackupFiles(deviceId, [{
        backupId, drive, prefix: segments.join('/'),
      }]);
      notify(ar ? `تم إرسال مجلد كامل (${result.queued} ملف) للاستعادة.` : `Queued a whole folder (${result.queued} file(s)) for restore.`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : t('actionFailed'), 'error');
    } finally {
      setRestoring(false);
    }
  };

  const openVersions = async (file: BackupTreeFile) => {
    setVersionsFile(file);
    setLoadingVersions(true);
    try {
      const result = await api.listFileVersions(deviceId, file.drive, file.relativePath, { page: 1, pageSize: 20 });
      setVersions(result.items);
      setVersionsTotal(result.pagination.total);
    } catch (error) {
      notify(error instanceof Error ? error.message : t('actionFailed'), 'error');
    } finally {
      setLoadingVersions(false);
    }
  };

  const restoreVersion = async (version: FileVersion) => {
    setRestoringVersion(version.backupId);
    try {
      const result = await api.restoreBackupFiles(deviceId, [{
        backupId: version.backupId, drive: version.drive, relativePath: version.relativePath,
      }]);
      notify(ar ? `تم إرسال نسخة ${formatDate(version.completedAt ?? version.requestedAt)} للاستعادة (${result.queued}).` : `Queued the version from ${formatDate(version.completedAt ?? version.requestedAt)} for restore (${result.queued}).`, 'success');
    } catch (error) {
      notify(error instanceof Error ? error.message : t('actionFailed'), 'error');
    } finally {
      setRestoringVersion('');
    }
  };

  const allVisibleSelected = visibleFiles.length > 0 && visibleFiles.every((file) => selected.includes(file.relativePath));
  const prefixLabel = segments.length ? segments.join(' / ') : (ar ? 'جذر القرص' : 'Drive root');

  return <>
    <PageHeader
      icon="folder"
      title={t('browse')}
      description={t('browseDescription')}
      actions={<>
        <Button variant="outline" icon="refresh" onClick={() => void loadTree()} loading={loadingTree || loading}>{t('refresh')}</Button>
        <Button icon="history" onClick={() => void restoreSelected()} loading={restoring} disabled={!selected.length || loadingTree}>
          {t('restoreSelected')} {selected.length > 0 && `(${selected.length})`}
        </Button>
      </>}
    />

    <section className="surface mb-5 grid gap-3 p-4 sm:grid-cols-3">
      <div className="label">{ar ? 'الجهاز' : 'Device'}
        <Select
          className="mt-1.5"
          value={deviceId}
          onValueChange={(id) => pickDevice(id)}
          searchable
          disabled={loading || devices.length === 0}
          options={devices.map((device) => ({ value: device.id, label: device.computerName, description: device.ipAddress ?? undefined }))}
          placeholder={ar ? 'اختر الجهاز' : 'Select a device'}
          ariaLabel={ar ? 'الجهاز' : 'Device'}
        />
      </div>
      <div className="label">{ar ? 'النسخة (حسب التاريخ)' : 'Backup (by date)'}
        <Select
          className="mt-1.5"
          value={backupId}
          onValueChange={(id) => pickBackup(id)}
          searchable
          disabled={!backups.length}
          options={backups.map((backup) => ({
            value: backup.id,
            label: `${formatDate(backup.completedAt ?? backup.createdAt)} · ${backup.type === 'full' ? t('fullBackup') : t('incrementalBackup')}`,
            description: backup.status,
          }))}
          placeholder={ar ? 'اختر النسخة' : 'Select a backup'}
          ariaLabel={ar ? 'النسخة' : 'Backup'}
        />
      </div>
      <div className="label">{ar ? 'القرص' : 'Drive'}
        <Select
          className="mt-1.5"
          value={drive}
          onValueChange={(value) => pickDrive(value)}
          disabled={!drives.length}
          options={[{ value: '', label: ar ? 'كل الأقراص' : 'All drives' }, ...drives.map((entry) => ({ value: entry.drive, label: `${entry.drive}:`, description: `${entry.fileCount} ${ar ? 'ملف' : 'files'}` }))]}
          ariaLabel={ar ? 'القرص' : 'Drive'}
        />
      </div>
    </section>

    {selectedBackup && <section className="surface mb-5 flex flex-wrap items-center gap-2 p-4 text-xs text-slate-500">
      <StatusBadge value={selectedBackup.status} />
      <span dir="ltr">{formatDate(selectedBackup.completedAt ?? selectedBackup.createdAt)}</span>
      <span>·</span><span>{formatBytes(selectedBackup.sizeBytes, language)}</span>
      {protection && <>
        <span>·</span>
        <span className="font-semibold text-emerald-600 dark:text-emerald-300" dir="ltr">{protection.protectedFiles.toLocaleString('en-US')}</span>
        <span>{ar ? 'ملف محمي حاليًا' : 'files currently protected'}</span>
        {protection.queuedRestores > 0 && <>
          <span>·</span>
          <span className="font-semibold text-amber-600 dark:text-amber-300" dir="ltr">{protection.queuedRestores}</span>
          <span>{ar ? 'استعادة معلقة' : 'pending restores'}</span>
        </>}
      </>}
    </section>}

    <section className="surface overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <button type="button" onClick={() => { setSegments([]); setPage(1); }} className="shrink-0 font-bold text-orange-500 hover:underline" disabled={!drive}>
            <span dir="ltr">{drive ? `${drive}:` : '—'}</span>
          </button>
          {segments.map((segment, index) => <span key={`${segment}-${index}`} className="flex min-w-0 items-center gap-2">
            <span className="text-slate-400">/</span>
            <button
              type="button"
              onClick={() => { setSegments(segments.slice(0, index + 1)); setPage(1); }}
              className={`truncate hover:underline ${index === segments.length - 1 ? 'font-bold text-slate-800 dark:text-slate-100' : 'text-orange-500'}`}
            >{segment}</button>
          </span>)}
          <span className="ms-2 hidden text-xs text-slate-400 sm:inline">{prefixLabel}</span>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block sm:w-64">
            <Icon name="search" size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={ar ? 'بحث في المجلد الحالي' : 'Search this folder'} className="input min-h-10 ps-9" />
          </label>
          {drive && <Button variant="outline" className="min-h-10 text-xs" icon="history" disabled={restoring || loadingTree} onClick={() => void restoreFolder()}>
            {ar ? 'استعادة هذا المجلد' : 'Restore this folder'}
          </Button>}
        </div>
      </header>

      {loading || loadingTree
        ? <div className="grid gap-3 p-4 sm:grid-cols-2"><div className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /><div className="h-20 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /></div>
        : !backupId
          ? <div className="p-10 text-center text-sm text-slate-500">{ar ? 'لا توجد نسخ لهذا الجهاز بعد.' : 'No backups for this device yet.'}</div>
          : !drive
            ? <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
              {drives.map((entry) => <button key={entry.drive} type="button" onClick={() => pickDrive(entry.drive)} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 text-start transition hover:border-orange-300 dark:border-slate-800 dark:hover:border-orange-800">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-orange-600 dark:bg-slate-800 dark:text-orange-300"><Icon name="hardDrive" size={19} /></span>
                <span><span dir="ltr" className="block font-mono text-sm font-bold">{entry.drive}:</span><span className="text-xs text-slate-500">{entry.fileCount} {ar ? 'ملف' : 'files'}</span></span>
              </button>)}
            </div>
            : directories.length === 0 && visibleFiles.length === 0
              ? <div className="p-10 text-center text-sm text-slate-500">{ar ? 'هذا المجلد فارغ.' : 'This folder is empty.'}</div>
              : <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 sm:p-4">
                {directories.map((name) => <button key={name} type="button" onClick={() => openFolder(name)} className="flex items-center gap-3 rounded-2xl border border-slate-200 p-4 text-start transition hover:border-orange-300 dark:border-slate-800 dark:hover:border-orange-800">
                  <span className="grid h-9 w-9 place-items-center rounded-xl bg-slate-100 text-orange-600 dark:bg-slate-800 dark:text-orange-300"><Icon name="folder" size={17} /></span>
                  <span className="min-w-0 truncate text-sm font-semibold">{name}</span>
                </button>)}
                {visibleFiles.map((file) => <article key={file.relativePath} className={`min-w-0 rounded-2xl border p-4 transition ${selected.includes(file.relativePath) ? 'border-orange-300 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <label className="flex min-w-0 cursor-pointer items-center gap-2">
                      <Checkbox checked={selected.includes(file.relativePath)} onCheckedChange={() => toggle(file.relativePath)} ariaLabel={file.name} />
                      <span className="min-w-0 truncate text-xs font-semibold" title={file.relativePath}>{file.name}</span>
                    </label>
                    <button type="button" onClick={() => void openVersions(file)} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-orange-500 hover:bg-orange-500/10">
                      {ar ? 'النسخ' : 'Versions'}
                    </button>
                  </div>
                  <code dir="ltr" className="mt-2 block break-all rounded-lg bg-slate-50 p-2 text-left text-[11px] text-slate-500 dark:bg-slate-950/60">{file.relativePath}</code>
                  <p className="mt-2 text-[11px] text-slate-500" dir="ltr">{formatBytes(file.sizeBytes, language)}</p>
                </article>)}
              </div>}

      {totalPages > 1 && drive && <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800">
        <span>{t('page')} {page} {t('of')} {totalPages} · {totalFiles}</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1 || loadingTree} onClick={() => { setSelected([]); setPage((current) => current - 1); }}>{t('previous')}</Button>
          <Button variant="outline" disabled={page >= totalPages || loadingTree} onClick={() => { setSelected([]); setPage((current) => current + 1); }}>{t('next')}</Button>
        </div>
      </footer>}
    </section>

    <Modal open={versionsFile !== null} onClose={() => setVersionsFile(null)} title={`${ar ? 'نسخ الملف' : 'File versions'} · ${versionsFile?.name ?? ''}`} size="lg">
      {loadingVersions
        ? <p className="p-4 text-sm text-slate-500">{t('loading')}</p>
        : versions.length === 0
          ? <p className="p-4 text-sm text-slate-500">{ar ? 'لا توجد نسخ أخرى محفوظة.' : 'No other retained versions.'}</p>
          : <div className="space-y-2">
            <p className="text-xs text-slate-500">{ar ? `إجمالي ${versionsTotal} نسخة — اختر نسخة لاستعادتها لمكانها الأصلي.` : `${versionsTotal} version(s) retained — pick one to restore to its original path.`}</p>
            {versions.map((version) => <div key={version.backupId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-800">
              <div className="min-w-0">
                <p className="text-sm font-bold" dir="ltr">{formatDate(version.completedAt ?? version.requestedAt)}</p>
                <p className="mt-1 text-xs text-slate-500" dir="ltr">{formatBytes(version.sizeBytes, language)} · {version.mode} · {version.status}</p>
                <p className="mt-1 font-mono text-[10px] text-slate-400" dir="ltr">{version.sha256.slice(0, 16)}…</p>
              </div>
              <Button icon="history" className="min-h-9 text-xs" loading={restoringVersion === version.backupId} disabled={restoringVersion !== ''} onClick={() => void restoreVersion(version)}>
                {ar ? 'استعادة هذه النسخة' : 'Restore this version'}
              </Button>
            </div>)}
          </div>}
    </Modal>
  </>;
}
