import { useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Icon, type IconName } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { useApp } from '../../contexts/AppContext';
import type { Device, Group } from '../../types';
import { Pagination } from '../../components/Pagination';
import type { PaginationMeta } from '../../types';

function Stat({ icon, label, value, accent }: {
  icon: IconName; label: string; value: string; accent?: boolean;
}) {
  return <div className="min-w-0 rounded-2xl border border-slate-100 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/50">
    <p className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400"><Icon name={icon} size={13} />{label}</p>
    <p className={`mt-1 truncate text-xs font-bold ${accent ? 'text-orange-600 dark:text-orange-300' : 'text-slate-800 dark:text-slate-100'}`} dir="auto">{value}</p>
  </div>;
}

export function GroupDevices({ group, devices, selectedIds, activeDeviceIds, onSelection, onSelectMany, onSave, onBackups, onEdit, onToggleContinuous, saving, pagination, onPage }: {
  group: Group; devices: Device[]; selectedIds: string[]; activeDeviceIds: Set<string>; onSelection: (id: string, checked: boolean) => void;
  onSelectMany: (ids: string[], checked: boolean) => void;
  onSave: () => void; onBackups: () => void; onEdit: () => void; onToggleContinuous: (enabled: boolean) => void; saving: boolean;
  pagination: PaginationMeta; onPage: (page: number) => void;
}) {
  const { t, language } = useApp();
  const ar = language === 'ar';
  const dayNames = ar
    ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const window = group.backupSettings?.backupWindow ?? null;
  const groupedDevices = devices.filter((device) => selectedIds.includes(device.id));
  const continuousOn = groupedDevices.filter((device) => device.continuousBackupEnabled).length;
  const allContinuous = groupedDevices.length > 0 && continuousOn === groupedDevices.length;
  const memberCount = group.deviceCount ?? group.deviceIds?.length ?? selectedIds.length;
  const backingUpCount = (group.deviceIds ?? selectedIds).filter((id) => activeDeviceIds.has(id)).length;

  const [query, setQuery] = useState('');
  useEffect(() => { setQuery(''); }, [group.id]);
  const needle = query.trim().toLowerCase();
  const visibleDevices = needle
    ? devices.filter((device) => device.computerName.toLowerCase().includes(needle) || (device.ipAddress ?? '').toLowerCase().includes(needle))
    : devices;

  const baseline = [...(group.deviceIds ?? [])].sort().join('|');
  const current = [...selectedIds].sort().join('|');
  const dirty = baseline !== current;

  const selectVisible = (checked: boolean) => {
    const ids = visibleDevices.map((device) => device.id);
    if (ids.length) onSelectMany(ids, checked);
  };
  const allVisibleSelected = visibleDevices.length > 0 && visibleDevices.every((device) => selectedIds.includes(device.id));

  return <section className="surface overflow-hidden">
    <header className="relative overflow-hidden border-b border-slate-100 p-5 dark:border-slate-800">
      <span aria-hidden className="pointer-events-none absolute -top-16 end-0 h-48 w-48 rounded-full bg-orange-500/10 blur-2xl" />
      <div className="relative flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-xl font-black text-white shadow-md shadow-orange-500/20">
            {group.name.trim().charAt(0).toUpperCase() || '؟'}
          </span>
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-widest text-orange-600 dark:text-orange-300">{t('department')}</p>
            <h2 className="mt-0.5 truncate text-xl font-bold text-slate-900 dark:text-white">{group.name}</h2>
            {group.description && <p className="mt-0.5 truncate text-xs text-slate-500">{group.description}</p>}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <Button variant="outline" icon="edit" onClick={onEdit}>{t('edit')}</Button>
          <Button icon="play" onClick={onBackups}>{language === 'ar' ? 'تشغيل نسخ القسم' : 'Run department backups'}</Button>
        </div>
      </div>
      <dl className="relative mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        <Stat icon="desktop" label={t('groupDevices')} value={`${memberCount}`} />
        <Stat
          icon="clock"
          label={t('autoBackup')}
          accent={Boolean(window)}
          value={window ? `${window.start}–${window.end} · ${window.days.map((day) => dayNames[day]).join('، ')}` : t('manualBackup')}
        />
        <Stat
          icon="history"
          label={t('nextRun')}
          value={window ? (group.nextAutoRunAt ? new Date(group.nextAutoRunAt).toLocaleString('en-US') : '—') : '—'}
        />
        <Stat icon="bolt" label={t('continuousBackup')} accent={continuousOn > 0} value={`${continuousOn}/${selectedIds.length}`} />
        <Stat icon="refresh" label={t('backingUp')} accent={backingUpCount > 0} value={`${backingUpCount}`} />
      </dl>
      {window?.lastRunAt && <p className="relative mt-2 text-[11px] text-slate-500">{t('lastRun')}: <bdi dir="ltr" className="font-semibold">{new Date(window.lastRunAt).toLocaleString('en-US')}</bdi></p>}
    </header>

    <div className="p-4 sm:p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-bold text-slate-900 dark:text-white">{t('groupDevices')}</h3>
        <p className="text-[11px] text-slate-500">{t('assignGroupForAutoBackup')}</p>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-40 flex-1">
          <Icon name="search" size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('searchDevices')}
            className="input min-h-9 ps-9 text-xs"
            aria-label={t('searchDevices')}
          />
        </label>
        <Button variant="ghost" className="min-h-9 px-3 text-xs" disabled={!visibleDevices.length || allVisibleSelected} onClick={() => selectVisible(true)}>{t('selectAll')}</Button>
        <Button variant="ghost" className="min-h-9 px-3 text-xs" disabled={!selectedIds.length} onClick={() => selectVisible(false)}>{t('clearSelection')}</Button>
        <Button icon="save" loading={saving} onClick={onSave} className="relative min-h-9 text-xs">
          {dirty && !saving && <span className="absolute end-1.5 top-1.5 h-2 w-2 rounded-full bg-amber-400" title={t('changeNotSaved')} />}
          {t('save')}
        </Button>
      </div>

      {selectedIds.length > 0 && <div className="mb-3 flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5 dark:bg-slate-950/50">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t('continuousBackup')} · <span dir="ltr">{continuousOn}/{selectedIds.length}</span></span>
        <button
          type="button"
          role="switch"
          aria-checked={allContinuous}
          aria-label={t('continuousBackup')}
          disabled={saving}
          onClick={() => onToggleContinuous(!allContinuous)}
          className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${allContinuous ? 'justify-end bg-orange-500' : 'justify-start bg-slate-300 dark:bg-slate-700'}`}
        >
          <span className="h-5 w-5 rounded-full bg-white shadow" />
        </button>
      </div>}

      {!devices.length
        ? <p className="py-8 text-center text-sm text-slate-500">{t('noDevices')}</p>
        : !visibleDevices.length
          ? <p className="rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center text-xs text-slate-500 dark:border-slate-700">{t('noFilesFound')}</p>
          : <div className="grid gap-2 sm:grid-cols-2">{visibleDevices.map((device) => {
            const checked = selectedIds.includes(device.id);
            return <label key={device.id} className={`flex cursor-pointer items-center justify-between gap-3 rounded-2xl border p-3 transition ${checked
              ? 'border-orange-300 bg-orange-50/60 shadow-sm dark:border-orange-800 dark:bg-orange-950/25'
              : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'}`}>
              <span className="flex min-w-0 items-center gap-3">
                <Checkbox checked={checked} onCheckedChange={(isChecked) => onSelection(device.id, isChecked)} />
                <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-black ${checked ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>
                  {device.computerName.trim().charAt(0).toUpperCase() || '?'}
                </span>
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="block truncate text-sm font-bold text-slate-800 dark:text-slate-100">{device.computerName}</span>
                    {device.agentUpdateAvailable && <StatusBadge value="needs_update" label={ar ? 'تحديث' : 'Update'} />}
                  </span>
                  <span className="mt-0.5 block truncate text-[11px] text-slate-500" dir="ltr">{device.ipAddress || '—'} · {device.group?.name || t('unassigned')}</span>
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1.5">
                <StatusBadge value={device.status} />
                {activeDeviceIds.has(device.id) && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />{t('backingUp')}
                </span>}
              </span>
            </label>;
          })}</div>}
      <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={onPage} />
    </div>
  </section>;
}
