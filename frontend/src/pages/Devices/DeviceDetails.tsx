import { useState } from 'react';
import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Icon, type IconName } from '../../components/Icon';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { StatusBadge } from '../../components/StatusBadge';
import { api } from '../../services/api';
import type { Device } from '../../types';
import { formatBytes } from '../../utils/format';
import { DeviceBackupExclusions } from './DeviceBackupExclusions';
import { DeviceArchiveSettings } from './DeviceArchiveSettings';

function DetailsSection({ icon, title, action, children, className = '' }: {
  icon: IconName; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return <section className={`min-w-0 rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900 ${className}`}>
    <div className="mb-3 flex items-center justify-between gap-2">
      <h3 className="flex min-w-0 items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-orange-500/10 text-orange-600 dark:text-orange-300"><Icon name={icon} size={15} /></span>
        <span className="truncate">{title}</span>
      </h3>
      {action}
    </div>
    {children}
  </section>;
}

export function DeviceDetails({ device, saving, onToggleDisk }: {
  device: Device; saving: boolean; onToggleDisk: (diskId: string, selected: boolean) => void;
}) {
  const { t, language } = useApp();
  const { notify } = useToast();
  const [downloading, setDownloading] = useState(false);
  const downloadInstaller = async () => {
    setDownloading(true);
    try { await api.downloadAgentInstaller(); notify(language === 'ar' ? 'تم تنزيل ملف تثبيت Agent' : 'Agent installer downloaded', 'success'); }
    catch (error) { notify(error instanceof Error ? error.message : (language === 'ar' ? 'تعذر تنزيل المثبّت' : 'Could not download installer'), 'error'); }
    finally { setDownloading(false); }
  };
  const selectedDisks = device.disks.filter((disk) => disk.selectedForBackup).length;
  return <div className="space-y-4">
    <section className="relative overflow-hidden rounded-2xl border border-orange-500/20 bg-gradient-to-br from-orange-500/10 via-transparent to-amber-500/10 p-4 dark:border-orange-800/40">
      <div className="relative flex flex-wrap items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-orange-500 to-amber-500 text-xl font-black text-white shadow-md shadow-orange-500/20">
          {device.computerName.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold text-slate-900 dark:text-white">{device.computerName}</h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500" dir="ltr">{device.ipAddress || '—'} · {device.windowsUsername || t('unknownUser')}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <StatusBadge value={device.status} />
            <StatusBadge value={device.approvalStatus} />
            {device.agentUpdateAvailable && <StatusBadge value="needs_update" label={t('agentUpdateAvailable')} />}
          </div>
        </div>
      </div>
    </section>

    <div className="grid items-start gap-4 lg:grid-cols-2">
      <DetailsSection
        icon="shield"
        title={language === 'ar' ? 'حالة Agent' : 'Agent status'}
        action={<Button variant="outline" icon="download" className="min-h-8 shrink-0 px-2.5 text-xs" loading={downloading} onClick={() => void downloadInstaller()}>{language === 'ar' ? 'إعادة تنزيل المثبّت' : 'Re-download installer'}</Button>}
      >
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-950/50">
            <p className="text-[11px] text-slate-500">{language === 'ar' ? 'إصدار Agent' : 'Agent version'}</p>
            <p className="mt-1 font-semibold text-slate-800 dark:text-slate-100" dir="ltr">{device.agentVersion ? `v${device.agentVersion}` : (language === 'ar' ? 'غير معروف' : 'Unknown')}</p>
          </div>
          <div className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-950/50">
            <p className="text-[11px] text-slate-500">{t('agent')}</p>
            <p className="mt-1 font-semibold capitalize text-slate-800 dark:text-slate-100">{device.agentStatus}</p>
          </div>
        </dl>
        {device.agentUpdateAvailable && <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">
          {language === 'ar' ? `التحديث المتاح: ${device.latestAgentVersion}` : `Available update: ${device.latestAgentVersion}`}
        </p>}
        {device.agentUpdateStatus && <div className="mt-2">
          {device.agentUpdateStatus === 'current'
            ? <StatusBadge value="current" />
            : <p className={`inline-flex items-center gap-1.5 text-xs font-semibold ${device.agentUpdateStatus === 'failed' ? 'text-rose-500' : 'text-orange-500'}`}>
              {device.agentUpdateStatus !== 'failed' && <Icon name="refresh" size={12} />}
              {t(device.agentUpdateStatus === 'failed' ? 'agentUpdateFailed'
                : device.agentUpdateStatus === 'queued' ? 'agentUpdateQueued'
                  : device.agentUpdateStatus === 'downloading' ? 'agentUpdateDownloading'
                    : 'agentUpdateInstalling')}
            </p>}
        </div>}
        {device.agentUpdateError && <p className="mt-1.5 break-words text-xs text-rose-400">{device.agentUpdateError}</p>}
      </DetailsSection>

      <DetailsSection icon="info" title={t('deviceDetails')}>
        <dl className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
          {[
            [t('username'), device.windowsUsername], [t('ipAddress'), device.ipAddress],
            [t('macAddress'), device.macAddress], [t('operatingSystem'), device.operatingSystem],
            [t('department'), device.group?.name || t('unassigned')],
            [t('lastSeen'), device.lastSeenAt ? new Date(device.lastSeenAt).toLocaleString('en-US') : '—'],
          ].map(([label, value]) => <div key={label} className="flex min-w-0 items-start justify-between gap-4 py-2 first:pt-0 last:pb-0">
            <dt className="shrink-0 text-xs text-slate-500">{label}</dt><dd className="min-w-0 break-words text-end text-xs font-semibold text-slate-800 dark:text-slate-100">{value || '—'}</dd>
          </div>)}
        </dl>
      </DetailsSection>
    </div>

    <DetailsSection
      icon="hardDrive"
      title={t('disks')}
      action={<span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300" dir="ltr">{selectedDisks} / {device.disks.length}</span>}
    >
      {device.disks.length === 0 ? <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500 dark:border-slate-700">{t('noData')}</p> :
        <div className="grid gap-2 sm:grid-cols-2">{device.disks.map((disk) => {
          const total = disk.totalBytes ?? 0;
          const free = disk.freeBytes ?? 0;
          const percent = total > 0 ? Math.round((Math.max(0, total - free) / total) * 100) : 0;
          const barTone = percent >= 90 ? 'bg-rose-500' : percent >= 70 ? 'bg-amber-500' : 'bg-emerald-500';
          const letter = (disk.mountPoint || disk.label || '?').trim().charAt(0).toUpperCase();
          return <label key={disk.id} className={`flex min-w-0 cursor-pointer flex-col gap-1.5 rounded-xl border p-2.5 transition ${disk.selectedForBackup
            ? 'border-orange-300 bg-orange-50/60 dark:border-orange-800 dark:bg-orange-950/25'
            : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'}`}>
            <span className="flex min-w-0 items-center gap-2">
              <Checkbox checked={disk.selectedForBackup} disabled={saving || !device.approved} onCheckedChange={(checked) => onToggleDisk(disk.id, checked)} />
              <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sm font-black ${disk.selectedForBackup ? 'bg-orange-500 text-white' : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300'}`}>{letter}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-bold text-slate-800 dark:text-slate-100">{disk.mountPoint || disk.label}</span>
                <span className="block truncate text-[10px] text-slate-500">{disk.filesystem || disk.label} · {percent}{language === 'ar' ? '٪' : '%'}</span>
              </span>
              <span className="shrink-0 text-[10px] text-slate-500" dir="ltr">{formatBytes(total, language)}</span>
            </span>
            {total > 0 && <>
              <span className="h-1.5 overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-700/60" dir="ltr">
                <span className={`block h-full rounded-full ${barTone}`} style={{ width: `${percent}%` }} />
              </span>
              <span className="truncate text-[10px] text-slate-500">{t('freeLabel')} {formatBytes(free, language)}</span>
            </>}
          </label>;
        })}</div>}
      {!device.approved && <p className="mt-2 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-700 dark:text-amber-300">{language === 'ar' ? 'اعتمد الجهاز قبل اختيار أقراص النسخ.' : 'Approve this device before selecting backup disks.'}</p>}
    </DetailsSection>

    <DeviceBackupExclusions device={device} />
    <DeviceArchiveSettings device={device} />
  </div>;
}
