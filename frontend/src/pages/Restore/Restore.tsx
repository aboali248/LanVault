import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Select } from '../../components/Select';
import { Checkbox } from '../../components/Checkbox';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import type { DeletedFile, Device } from '../../types';

const pageSize = 50;

export function Restore() {
  const { language, t } = useApp();
  const { notify } = useToast();
  const ar = language === 'ar';
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [items, setItems] = useState<DeletedFile[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loadingDevices, setLoadingDevices] = useState(true);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const loadDevices = useCallback(async () => {
    setLoadingDevices(true);
    try {
      const result = await api.listDevices({ page: 1, pageSize: 100, approval: 'approved' });
      setDevices(result.items);
      setDeviceId((current) => current && result.items.some((device) => device.id === current)
        ? current : result.items[0]?.id ?? '');
    } catch (error) {
      notify(error instanceof Error ? error.message : (ar ? 'تعذر تحميل الأجهزة' : 'Could not load devices'), 'error');
    } finally {
      setLoadingDevices(false);
    }
  }, [ar, notify]);

  const loadFiles = useCallback(async () => {
    if (!deviceId) {
      setItems([]);
      setTotal(0);
      return;
    }
    setLoadingFiles(true);
    try {
      const result = await api.listDeletedFiles(deviceId, { page, pageSize });
      setItems(result.items);
      setTotal(result.pagination.total);
      setSelected([]);
    } catch (error) {
      notify(error instanceof Error ? error.message : (ar ? 'تعذر تحميل الملفات المحذوفة' : 'Could not load deleted files'), 'error');
    } finally {
      setLoadingFiles(false);
    }
  }, [ar, deviceId, notify, page]);

  useEffect(() => { void loadDevices(); }, [loadDevices]);
  useEffect(() => { void loadFiles(); }, [loadFiles]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return items;
    return items.filter((item) => `${item.drive}:\\${item.relativePath}`.toLocaleLowerCase().includes(query));
  }, [items, search]);

  const restore = async () => {
    if (!deviceId || !selected.length) return;
    setRestoring(true);
    try {
      const result = await api.restoreDeletedFiles(deviceId, selected);
      notify(ar ? `تم إرسال ${result.queued} ملف للاستعادة. سيعيد الجهاز الملفات عند اتصاله.` : `${result.queued} file restore request(s) queued. The device will restore them when it connects.`, 'success');
      setSelected([]);
      setPage(1);
      await loadFiles();
    } catch (error) {
      notify(error instanceof Error ? error.message : (ar ? 'تعذرت جدولة الاستعادة' : 'Could not queue file restore'), 'error');
    } finally {
      setRestoring(false);
    }
  };

  const toggle = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (item?.restoreStatus === 'queued') return;
    setSelected((current) => current.includes(id)
      ? current.filter((entry) => entry !== id)
      : [...current, id]);
  };
  const selectableVisible = visibleItems.filter((item) => item.restoreStatus !== 'queued');
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((item) => selected.includes(item.id));
  const selectedOnPage = items.filter((item) => selected.includes(item.id)).length;

  return <>
    <PageHeader
      icon="history"
      title={t('restore')}
      description={t('restoreDescription')}
      actions={<>
        <Button variant="outline" icon="refresh" onClick={() => void loadFiles()} loading={loadingFiles || loadingDevices}>{t('refresh')}</Button>
        <Button icon="history" onClick={() => void restore()} loading={restoring} disabled={!selected.length || loadingFiles}>
          {t('restoreSelected')} {selected.length > 0 && `(${selected.length})`}
        </Button>
      </>}
    />

    <section className="mb-5 grid gap-3 sm:grid-cols-3">
      {[
        { label: t('deletedFiles'), value: total, icon: 'trash' as const, tone: 'text-rose-600 bg-rose-500/10' },
        { label: t('selectedFiles'), value: selectedOnPage, icon: 'check' as const, tone: 'text-orange-600 bg-orange-500/10' },
        { label: t('selectedDevice'), value: devices.find((device) => device.id === deviceId)?.computerName ?? '—', icon: 'desktop' as const, tone: 'text-sky-600 bg-sky-500/10' },
      ].map((item) => <article key={item.label} className="surface flex min-w-0 items-center gap-3 p-4">
        <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${item.tone}`}><Icon name={item.icon} size={19} /></span>
        <div className="min-w-0"><p className="text-xs text-slate-500">{item.label}</p><p className="mt-1 truncate text-base font-bold text-slate-900 dark:text-white">{item.value}</p></div>
      </article>)}
    </section>

    <section className="surface mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <label className="flex items-center gap-3 text-sm font-semibold text-slate-700 dark:text-slate-200">
        <span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-500/10 text-orange-600"><Icon name="devices" size={18} /></span>
        <span>{ar ? 'الجهاز المراد استعادة ملفاته' : 'Device to restore files to'}</span>
      </label>
      <Select
        className="w-full sm:max-w-md"
        value={deviceId}
        onValueChange={(id) => { setDeviceId(id); setPage(1); setSelected([]); }}
        searchable
        disabled={loadingDevices || devices.length === 0}
        options={devices.map((device) => ({ value: device.id, label: device.computerName, description: device.ipAddress ?? undefined }))}
        placeholder={ar ? 'اختر الجهاز' : 'Select a device'}
        ariaLabel={ar ? 'الجهاز المراد استعادة ملفاته' : 'Device to restore files to'}
      />
    </section>

    <section className="surface overflow-hidden">
      <header className="flex flex-col gap-3 border-b border-slate-100 p-4 dark:border-slate-800 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t('deletedFiles')}</h2>
          <p className="mt-1 text-xs text-slate-500">{ar ? `إجمالي ${total} ملف · ${selectedOnPage} محدد في الصفحة` : `${total} total · ${selectedOnPage} selected on this page`}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <label className="relative block sm:w-72">
            <Icon name="search" size={16} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('searchDeletedFiles')}
              className="input min-h-10 ps-9"
            />
          </label>
          {selectableVisible.length > 0 && <label className="flex min-h-10 cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300">
            <Checkbox
              checked={allVisibleSelected}
              onCheckedChange={(checked) => setSelected((current) => checked
                ? Array.from(new Set([...current, ...selectableVisible.map((item) => item.id)]))
                : current.filter((id) => !selectableVisible.some((item) => item.id === id)))}
              ariaLabel={t('selectVisibleFiles')}
            />
            {t('selectVisibleFiles')}
          </label>}
        </div>
      </header>

      {loadingFiles || loadingDevices
        ? <div className="grid gap-3 p-4 sm:grid-cols-2"><div className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /><div className="h-28 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" /></div>
        : devices.length === 0
          ? <div className="p-10 text-center"><Icon name="devices" size={28} className="mx-auto text-slate-400" /><p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{ar ? 'لا توجد أجهزة معتمدة.' : 'There are no approved devices.'}</p></div>
          : items.length === 0
            ? <div className="p-10 text-center"><Icon name="folder" size={30} className="mx-auto text-slate-400" /><p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{ar ? 'لا توجد ملفات محذوفة مسجلة لهذا الجهاز.' : 'No deleted files are recorded for this device.'}</p><p className="mx-auto mt-1 max-w-lg text-xs text-slate-500">{t('noDeletedFilesHint')}</p></div>
            : visibleItems.length === 0
              ? <div className="p-10 text-center"><Icon name="search" size={28} className="mx-auto text-slate-400" /><p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{t('noFilesFound')}</p></div>
              : <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 sm:p-4">
                {visibleItems.map((item) => <article key={item.id} className={`min-w-0 rounded-2xl border p-4 transition ${selected.includes(item.id) ? 'border-orange-300 bg-orange-50/50 dark:border-orange-800 dark:bg-orange-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <label className="flex min-w-0 cursor-pointer items-center gap-2.5">
                      <Checkbox checked={selected.includes(item.id)} disabled={item.restoreStatus === 'queued'} onCheckedChange={() => toggle(item.id)} ariaLabel={`${item.drive}:\\${item.relativePath}`} />
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-slate-100 text-orange-600 dark:bg-slate-800 dark:text-orange-300"><Icon name="folder" size={17} /></span>
                      <span className="rounded-lg bg-slate-100 px-2 py-1 font-mono text-xs font-bold text-slate-700 dark:bg-slate-800 dark:text-slate-200" dir="ltr">{item.drive}:</span>
                    </label>
                    <StatusBadge value={item.restoreStatus} label={item.restoreStatus === 'failed' ? t('restoreFailed') : item.restoreStatus === 'queued' ? t('restoreQueued') : t('restoreDeleted')} />
                  </div>
                  <code dir="ltr" className="mt-3 block min-h-10 break-all rounded-xl bg-slate-50 p-3 text-left text-xs leading-5 text-slate-700 dark:bg-slate-950/60 dark:text-slate-300">{item.drive}:\\{item.relativePath}</code>
                  <div className="mt-3 flex items-center gap-2 text-[11px] text-slate-500"><Icon name="clock" size={14} /><span>{t('detectedAt')}: <bdi dir="ltr">{new Date(item.detectedAt).toLocaleString('en-US')}</bdi></span></div>
                  {item.restoreError && <p className="mt-3 break-words rounded-xl bg-rose-50 p-3 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{item.restoreError}</p>}
                </article>)}
              </div>}

      {totalPages > 1 && <footer className="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500 dark:border-slate-800">
        <span>{t('page')} {page} {t('of')} {totalPages}</span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={page <= 1 || loadingFiles} onClick={() => { setSelected([]); setPage((current) => current - 1); }}>{t('previous')}</Button>
          <Button variant="outline" disabled={page >= totalPages || loadingFiles} onClick={() => { setSelected([]); setPage((current) => current + 1); }}>{t('next')}</Button>
        </div>
      </footer>}
    </section>
  </>;
}
