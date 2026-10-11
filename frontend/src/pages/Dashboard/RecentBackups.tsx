import { EmptyState } from '../../components/StateViews';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon } from '../../components/Icon';
import { useApp } from '../../contexts/AppContext';
import type { Backup } from '../../types';
import { formatBytes, formatDate } from '../../utils/format';

export function RecentBackups({ backups }: { backups?: Backup[] }) {
  const { t, language } = useApp();
  return <section className="surface overflow-hidden">
    <div className="flex items-center justify-between px-5 py-4"><div><h2 className="font-bold text-slate-800 dark:text-white">{t('recentBackups')}</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('backupHistory')}</p></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-50 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300"><Icon name="history" /></span></div>
    {!backups?.length ? <EmptyState icon="history" title={t('noBackups')} /> : <div className="table-wrap"><table className="table"><thead><tr><th>{t('computerName')}</th><th>{t('type')}</th><th>{t('status')}</th><th>{t('size')}</th><th>{t('endTime')}</th></tr></thead><tbody>{backups.map((backup) => <tr key={backup.id}><td className="font-semibold">{backup.deviceName ?? backup.deviceId}</td><td>{backup.type === 'full' ? t('fullBackup') : t('incrementalBackup')}</td><td><StatusBadge value={backup.status} /></td><td>{formatBytes(backup.sizeBytes, language)}</td><td>{formatDate(backup.completedAt ?? backup.startedAt, language)}</td></tr>)}</tbody></table></div>}
  </section>;
}
