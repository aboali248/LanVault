import { Icon, type IconName } from '../../components/Icon';
import { LoadingState } from '../../components/StateViews';
import { useApp } from '../../contexts/AppContext';
import type { DashboardStats } from '../../types';

export function StatsCards({ stats, loading }: { stats?: DashboardStats; loading: boolean }) {
  const { t } = useApp();
  if (loading) return <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><LoadingState rows={1} /><LoadingState rows={1} /><LoadingState rows={1} /><LoadingState rows={1} /></div>;
  const cards: Array<{ label: string; value: number; note: string; icon: IconName; tint: string }> = [
    { label: t('devicesTotal'), value: stats?.devices ?? 0, note: `${stats?.onlineDevices ?? 0} ${t('online')}`, icon: 'desktop', tint: 'from-orange-400 to-orange-600' },
    { label: t('online'), value: stats?.onlineDevices ?? 0, note: `${stats?.offlineDevices ?? 0} ${t('offline')}`, icon: 'wifi', tint: 'from-orange-500 to-amber-600' },
    { label: t('backupOperations'), value: stats?.backups ?? 0, note: `${stats?.runningBackups ?? 0} ${t('running')}`, icon: 'backups', tint: 'from-orange-500 to-orange-700' },
    { label: t('running'), value: stats?.runningBackups ?? 0, note: t('live'), icon: 'bolt', tint: 'from-violet-500 to-fuchsia-600' },
  ];
  return <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
    {cards.map((card) => <article key={card.label} className="surface group relative overflow-hidden p-5 animate-fade-up">
      <span className={`absolute -left-8 -top-8 h-28 w-28 rounded-full bg-gradient-to-br ${card.tint} opacity-[.08] transition group-hover:scale-125`} />
      <div className="relative flex items-start justify-between">
        <div><p className="text-sm font-medium text-slate-500 dark:text-slate-400">{card.label}</p><p className="mt-2 text-3xl font-bold tracking-tight text-slate-900 dark:text-white" dir="ltr">{card.value.toLocaleString('en-US')}</p><p className="mt-2 text-xs font-semibold text-slate-500 dark:text-slate-400">{card.note}</p></div>
        <span className={`grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br ${card.tint} text-white shadow-lg`}><Icon name={card.icon} size={19} /></span>
      </div>
    </article>)}
  </section>;
}
