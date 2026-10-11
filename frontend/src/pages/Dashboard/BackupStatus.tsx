import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { EmptyState, LoadingState } from '../../components/StateViews';
import { useApp } from '../../contexts/AppContext';
import type { StorageStatus, SystemStatus } from '../../types';
import { formatBytes, formatDate } from '../../utils/format';

export function BackupStatus({ storage, system, loading }: { storage?: StorageStatus; system?: SystemStatus; loading: boolean }) {
  const { t, language } = useApp();
  if (loading) return <LoadingState rows={4} />;
  if (!storage && !system) return <EmptyState icon="server" />;
  const usage = storage?.totalBytes ? Math.min(100, Math.round(((storage.usedBytes ?? 0) / storage.totalBytes) * 100)) : 0;
  return <section className="grid gap-4 lg:grid-cols-5">
    <article className="surface p-5 lg:col-span-3">
      <div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-800 dark:text-white">{t('storage')}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{storage?.destination || '—'}</p></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300"><Icon name="hardDrive" /></span></div>
      <div className="mt-7"><div className="mb-2 flex justify-between text-sm"><span className="font-semibold text-slate-700 dark:text-slate-200">{formatBytes(storage?.usedBytes, language)} / {formatBytes(storage?.totalBytes, language)}</span><span className="text-slate-500">{usage}%</span></div><div className="h-3 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-l from-orange-400 to-orange-600 transition-[width] duration-500" style={{ width: `${usage}%` }} /></div><p className="mt-3 text-xs text-slate-500 dark:text-slate-400">{formatBytes(storage?.freeBytes, language)} {language === 'ar' ? 'متاح' : 'available'}</p></div>
    </article>
    <article className="surface p-5 lg:col-span-2">
      <div className="flex items-center justify-between"><div><h2 className="font-bold text-slate-800 dark:text-white">{t('systemStatus')}</h2><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{system?.version || 'LanVault'}</p></div><span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300"><Icon name="shield" /></span></div>
      <div className="mt-6 flex items-center justify-between gap-3"><StatusBadge value={system?.status} /><span className="text-xs text-slate-500 dark:text-slate-400">{formatDate(system?.serverTime, language)}</span></div>{system?.message && <p className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">{system.message}</p>}
    </article>
  </section>;
}
