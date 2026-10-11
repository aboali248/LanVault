import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { EmptyState } from '../../components/StateViews';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { useApp } from '../../contexts/AppContext';
import type { Backup, BackupKind, Device } from '../../types';
import { formatBytes } from '../../utils/format';
import { BackupProgress } from './BackupProgress';

function FilterChip({ active, onClick, dot, children }: {
  active: boolean; onClick: () => void; dot?: string; children: React.ReactNode;
}) {
  return <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] transition ${active
      ? 'border-orange-500 bg-orange-500 font-bold text-white shadow-sm shadow-orange-500/25 hover:bg-orange-400'
      : 'border-slate-200 bg-white font-semibold text-slate-600 hover:border-orange-300 hover:text-orange-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:border-orange-700 dark:hover:text-orange-300'}`}
  >
    {dot && <span className={`h-2 w-2 rounded-full bg-gradient-to-br ${dot}`} />}
    {children}
  </button>;
}

const CHIP_DOTS = [
  'from-orange-500 to-amber-500',
  'from-sky-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-violet-500 to-purple-500',
  'from-rose-500 to-pink-500',
  'from-indigo-500 to-blue-500',
];

function toDraft(minutes: number): { amount: string; unit: 'min' | 'hour' } {
  if (minutes >= 60 && minutes % 60 === 0) return { amount: String(minutes / 60), unit: 'hour' };
  return { amount: String(minutes), unit: 'min' };
}

function IntervalEditor({ device, defaultMinutes, disabled, saving, onSave }: {
  device: Device; defaultMinutes: number; disabled: boolean; saving: boolean;
  onSave: (device: Device, intervalMinutes: number | null) => void;
}) {
  const { t } = useApp();
  const [draft, setDraft] = useState(() => toDraft(device.backupIntervalMinutes ?? defaultMinutes));
  const firstRender = useRef(true);
  // Resync the field after a save completes (or the value changes elsewhere).
  useEffect(() => {
    setDraft(toDraft(device.backupIntervalMinutes ?? defaultMinutes));
  }, [device.backupIntervalMinutes, defaultMinutes]);
  // Auto-apply a short moment after the user edits the value or unit.
  useEffect(() => {
    if (firstRender.current) { firstRender.current = false; return; }
    const timer = window.setTimeout(() => {
      const raw = Number(draft.amount);
      if (!draft.amount.trim() || !Number.isFinite(raw)) {
        if (device.backupIntervalMinutes !== null) onSave(device, null);
        else setDraft(toDraft(defaultMinutes));
        return;
      }
      const minutes = Math.min(1440, Math.max(1, Math.round(draft.unit === 'hour' ? raw * 60 : raw)));
      if (minutes !== device.backupIntervalMinutes) onSave(device, minutes);
    }, 800);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.amount, draft.unit]);
  const step = (delta: number) => {
    const max = draft.unit === 'hour' ? 24 : 1440;
    const raw = Number(draft.amount);
    const base = draft.amount.trim() !== '' && Number.isFinite(raw)
      ? raw
      : (draft.unit === 'hour' ? defaultMinutes / 60 : defaultMinutes);
    const next = Math.min(max, Math.max(1, Math.floor(base) + delta));
    setDraft((current) => ({ ...current, amount: String(next) }));
  };
  const stepperDisabled = disabled || saving;
  return <div className="mt-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-950/50">
    <div className="flex items-center gap-2">
      <span className="shrink-0 text-[11px] font-semibold text-slate-500">{t('continuousEvery')}</span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5" dir="ltr">
        <div className="flex h-9 min-w-0 flex-1 items-center overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition focus-within:border-orange-500 focus-within:ring-4 focus-within:ring-orange-500/15 dark:border-slate-700 dark:bg-slate-900">
          <button
            type="button"
            aria-label="−"
            disabled={stepperDisabled}
            onClick={() => step(-1)}
            className="grid h-full w-8 shrink-0 place-items-center text-lg font-black leading-none text-slate-400 transition hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-orange-950/40"
          >−</button>
          <input
            type="number"
            min={1}
            max={draft.unit === 'hour' ? 24 : 1440}
            value={draft.amount}
            disabled={stepperDisabled}
            onChange={(event) => setDraft((current) => ({ ...current, amount: event.target.value }))}
            className="no-spinner h-full w-full min-w-0 border-x border-slate-100 bg-transparent text-center text-sm font-bold text-slate-800 outline-none dark:border-slate-800 dark:text-slate-100"
            aria-label={t('continuousInterval')}
          />
          <button
            type="button"
            aria-label="+"
            disabled={stepperDisabled}
            onClick={() => step(1)}
            className="grid h-full w-8 shrink-0 place-items-center text-lg font-black leading-none text-slate-400 transition hover:bg-orange-50 hover:text-orange-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-orange-950/40"
          >+</button>
        </div>
        <div role="group" aria-label={t('continuousInterval')} className="flex shrink-0 items-center gap-0.5 rounded-xl border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-slate-800">
          {(['min', 'hour'] as const).map((unit) => <button
            key={unit}
            type="button"
            aria-pressed={draft.unit === unit}
            disabled={stepperDisabled}
            onClick={() => setDraft((current) => ({ ...current, unit }))}
            className={`rounded-lg px-2.5 py-1.5 text-[11px] transition disabled:cursor-not-allowed disabled:opacity-40 ${draft.unit === unit
              ? 'bg-white font-bold text-orange-600 shadow-sm dark:bg-slate-900 dark:text-orange-300'
              : 'font-semibold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'}`}
          >{unit === 'min' ? t('intervalMinutesUnit') : t('intervalHoursUnit')}</button>)}
        </div>
      </div>
      {saving && <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />}
    </div>
    {!saving && device.backupIntervalMinutes === null
      && <p className="mt-1 text-[10px] text-slate-400">{t('intervalGlobalDefault')}: {defaultMinutes}</p>}
  </div>;
}

export function DeviceBackupTargets({ devices, backups, mode, loading, startingDeviceId, savingDiskDeviceId, stoppingBackupId, togglingContinuousId, savingIntervalDeviceId, defaultIntervalMinutes, onStart, onStop, onToggleDisk, onToggleContinuous, onIntervalChange }: {
  devices: Device[];
  backups: Backup[];
  mode: BackupKind;
  loading: boolean;
  startingDeviceId?: string;
  savingDiskDeviceId?: string;
  stoppingBackupId?: string;
  togglingContinuousId?: string;
  savingIntervalDeviceId?: string;
  defaultIntervalMinutes: number;
  onStart: (device: Device) => void;
  onStop: (backup: Backup) => void;
  onToggleDisk: (device: Device, diskId: string, selected: boolean) => void;
  onToggleContinuous: (device: Device) => void;
  onIntervalChange: (device: Device, intervalMinutes: number | null) => void;
}) {
  const { t, language } = useApp();
  const [filterQuery, setFilterQuery] = useState('');
  const [filterGroup, setFilterGroup] = useState('');
  const [collapsedDisks, setCollapsedDisks] = useState<Record<string, boolean>>(() => {
    try {
      return JSON.parse(localStorage.getItem('lanvault-disks-collapsed') ?? '{}') as Record<string, boolean>;
    } catch {
      return {};
    }
  });
  const toggleDisks = (id: string) => setCollapsedDisks((current) => {
    const next = { ...current, [id]: !current[id] };
    try {
      localStorage.setItem('lanvault-disks-collapsed', JSON.stringify(next));
    } catch {
      // Collapse state is a nicety; the section still works without storage.
    }
    return next;
  });

  const { groupOptions, unassignedCount } = useMemo(() => {
    const map = new Map<string, { name: string; count: number }>();
    let unassigned = 0;
    for (const device of devices) {
      if (device.group) {
        const entry = map.get(device.group.id) ?? { name: device.group.name, count: 0 };
        entry.count += 1;
        map.set(device.group.id, entry);
      } else {
        unassigned += 1;
      }
    }
    const options = [...map.entries()]
      .map(([id, entry], index) => ({ id, ...entry, dot: CHIP_DOTS[index % CHIP_DOTS.length] }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return { groupOptions: options, unassignedCount: unassigned };
  }, [devices]);
  const needle = filterQuery.trim().toLowerCase();
  const visibleDevices = devices.filter((device) => {
    if (filterGroup === 'none') {
      if (device.group) return false;
    } else if (filterGroup && device.group?.id !== filterGroup) {
      return false;
    }
    if (needle && !device.computerName.toLowerCase().includes(needle)
      && !(device.ipAddress ?? '').toLowerCase().includes(needle)) {
      return false;
    }
    return true;
  });
  const filtering = needle !== '' || filterGroup !== '';
  const clearFilters = () => { setFilterQuery(''); setFilterGroup(''); };

  if (loading && devices.length === 0) {
    return <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-2xl bg-slate-100 dark:bg-slate-800" />)}
    </div>;
  }
  if (devices.length === 0) {
    return <EmptyState icon="devices" title={t('noApprovedDevices')} description={t('noApprovedDevicesHint')} />;
  }

  return <>
    <div className="px-3 pt-3 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="relative min-w-44 flex-1">
          <Icon name="search" size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={filterQuery}
            onChange={(event) => setFilterQuery(event.target.value)}
            placeholder={t('searchDevices')}
            className="input min-h-9 ps-9 text-xs"
            aria-label={t('searchDevices')}
          />
        </label>
        {filtering && <Button variant="ghost" icon="close" className="min-h-9 px-2.5 text-xs" onClick={clearFilters}>{t('clearSearch')}</Button>}
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300" dir="ltr">{visibleDevices.length} / {devices.length}</span>
      </div>
      <div role="group" aria-label={t('department')} className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1">
        <FilterChip active={filterGroup === ''} onClick={() => setFilterGroup('')}>{t('all')} · {devices.length}</FilterChip>
        {groupOptions.map((option) => <FilterChip key={option.id} active={filterGroup === option.id} dot={option.dot} onClick={() => setFilterGroup(option.id)}>{option.name} · {option.count}</FilterChip>)}
        {unassignedCount > 0 && <FilterChip active={filterGroup === 'none'} onClick={() => setFilterGroup('none')}>{t('unassigned')} · {unassignedCount}</FilterChip>}
      </div>
    </div>
    {!visibleDevices.length
      ? <EmptyState icon="search" title={t('noDevices')} action={<Button variant="outline" onClick={clearFilters}>{t('clearSearch')}</Button>} />
      : <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4 xl:grid-cols-3">
        {visibleDevices.map((device) => {
      const selectedCount = device.disks.filter((disk) => disk.selectedForBackup).length;
      const activeBackup = backups.find((backup) => backup.deviceId === device.id &&
        ['queued', 'running', 'cancel_requested'].includes(backup.status));
      const busy = startingDeviceId === device.id || savingDiskDeviceId === device.id ||
        (activeBackup !== undefined && stoppingBackupId === activeBackup.id);
      return <article key={device.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-orange-300 hover:shadow-soft dark:border-slate-800 dark:bg-slate-900 dark:hover:border-orange-800">
        <header className="flex min-w-0 items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/40 dark:text-orange-300">
              <Icon name="desktop" size={19} />
            </span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">{device.computerName}</h3>
              <p className="mt-1 truncate font-mono text-[10px] text-slate-500" dir="ltr">{device.ipAddress || '—'}</p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <StatusBadge value={device.status} />
            {device.agentUpdateAvailable && <StatusBadge value="needs_update" label={t('agentUpdateAvailable')} />}
          </div>
        </header>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[10px]">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{device.group?.name || t('unassigned')}</span>
          <span className="rounded-full bg-orange-50 px-2.5 py-1 font-semibold text-orange-700 dark:bg-orange-950/40 dark:text-orange-300">
            {mode === 'full' ? t('fullBackup') : t('incrementalBackup')}
          </span>
          <span className={`rounded-full px-2.5 py-1 font-semibold ${device.continuousBackupEnabled ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'}`}>
            {device.continuousBackupEnabled ? t('continuousEnabled') : t('continuousDisabled')}
          </span>
        </div>
        {!device.group && <p className="mt-2 text-[11px] leading-5 text-slate-500">{t('assignGroupForAutoBackup')}</p>}
        <div className="mt-3 rounded-xl border border-slate-200 px-3 py-2.5 dark:border-slate-800">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">{t('continuousBackup')}</span>
            <button
              type="button"
              role="switch"
              aria-checked={device.continuousBackupEnabled}
              aria-label={t('continuousBackup')}
              disabled={busy || togglingContinuousId === device.id}
              onClick={() => onToggleContinuous(device)}
              className={`flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${device.continuousBackupEnabled ? 'justify-end bg-orange-500' : 'justify-start bg-slate-300 dark:bg-slate-700'}`}
            >
              <span className="h-5 w-5 rounded-full bg-white shadow" />
            </button>
          </div>
          <IntervalEditor
            device={device}
            defaultMinutes={defaultIntervalMinutes}
            disabled={busy}
            saving={savingIntervalDeviceId === device.id}
            onSave={onIntervalChange}
          />
        </div>

        {activeBackup && <div className="mt-3 rounded-xl border border-orange-200 bg-orange-50/60 p-3 dark:border-orange-900/50 dark:bg-orange-950/20">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[10px] font-semibold text-slate-600 dark:text-slate-300">{t('activeDeviceBackup')}</span>
            <StatusBadge value={activeBackup.status} />
          </div>
          <BackupProgress backup={activeBackup} />
        </div>}

        <div className="mt-4 flex-1">
          <button
            type="button"
            onClick={() => toggleDisks(device.id)}
            aria-expanded={!collapsedDisks[device.id]}
            aria-label={collapsedDisks[device.id] ? t('expandSection') : t('collapseSection')}
            className="mb-2 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 transition hover:bg-slate-50 dark:hover:bg-slate-800/50"
          >
            <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200">
              <Icon name="chevronDown" size={15} className={`shrink-0 text-slate-400 transition-transform ${collapsedDisks[device.id] ? '-rotate-90' : ''}`} />
              <span className="truncate">{t('selectDisks')}</span>
            </span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{selectedCount} / {device.disks.length}</span>
          </button>
          {device.disks.length === 0
            ? <p className="rounded-xl border border-dashed border-slate-300 p-3 text-xs text-slate-500 dark:border-slate-700">{t('noData')}</p>
            : !collapsedDisks[device.id] && <div className="grid grid-cols-2 gap-2">
              {device.disks.map((disk) => {
                const total = disk.totalBytes ?? 0;
                const free = disk.freeBytes ?? 0;
                const used = Math.max(0, total - free);
                const percent = total > 0 ? Math.round((used / total) * 100) : 0;
                const barTone = percent >= 90 ? 'bg-rose-500' : percent >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
                const letter = (disk.mountPoint || disk.label || '?').trim().charAt(0).toUpperCase();
                return <label key={disk.id} className={`flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-xl border p-2.5 transition ${disk.selectedForBackup ? 'border-orange-300 bg-orange-50/70 shadow-sm dark:border-orange-800 dark:bg-orange-950/30' : 'border-slate-200 hover:border-slate-300 hover:shadow-sm dark:border-slate-700 dark:hover:border-slate-600'}`}>
                  <span className="flex min-w-0 items-center gap-2">
                    <Checkbox checked={disk.selectedForBackup} disabled={savingDiskDeviceId === device.id || Boolean(activeBackup)} onCheckedChange={(checked) => onToggleDisk(device, disk.id, checked)} />
                    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-black ${disk.selectedForBackup ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>{letter}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">{disk.mountPoint || disk.label}</span>
                      <span className="block truncate text-[10px] text-slate-400">{disk.filesystem || t('disks')} · {percent}{language === 'ar' ? '٪' : '%'}</span>
                    </span>
                  </span>
                  {total > 0
                    ? <>
                      <span className="h-1.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/60" dir="ltr">
                        <span className={`block h-full rounded-full transition-all ${barTone}`} style={{ width: `${percent}%` }} />
                      </span>
                      <span className="flex items-center justify-between gap-1 text-[10px] text-slate-500 dark:text-slate-400">
                        <span className="truncate">{t('freeLabel')} {formatBytes(free, language)}</span>
                        <span dir="ltr" className="shrink-0">{formatBytes(total, language)}</span>
                      </span>
                    </>
                    : <span className="text-[10px] text-slate-400">—</span>}
                </label>;
              })}
            </div>}
        </div>

        <div className="mt-4 border-t border-slate-100 pt-3 dark:border-slate-800">
          {activeBackup
            ? <Button className="w-full" variant="danger" icon="stop" loading={stoppingBackupId === activeBackup.id}
              disabled={busy || activeBackup.status === 'cancel_requested'}
              onClick={() => onStop(activeBackup)}>
              {activeBackup.status === 'cancel_requested' ? t('backupStopping') : t('stopBackup')}
            </Button>
            : <Button className="w-full" icon="play" loading={startingDeviceId === device.id}
              disabled={!selectedCount || busy}
              onClick={() => onStart(device)}>
              {t('startBackup')}
            </Button>}
        </div>
      </article>;
        })}
      </div>}
  </>;
}
