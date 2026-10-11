import { useState } from 'react';
import { Button } from '../../components/Button';
import { EmptyState } from '../../components/StateViews';
import { Pagination } from '../../components/Pagination';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon } from '../../components/Icon';
import { useApp } from '../../contexts/AppContext';
import type { Backup, PaginationMeta } from '../../types';
import { formatBytes, formatDate } from '../../utils/format';
import { BackupProgress } from './BackupProgress';

export function BackupTable({ backups, pagination, onPage, onStop, onHistory, onDelete, busyId, deletingId }: {
  backups: Backup[]; pagination?: PaginationMeta; onPage: (page: number) => void;
  onStop: (backup: Backup) => void; onHistory: (backup: Backup) => void; onDelete: (backup: Backup) => void;
  busyId?: string; deletingId?: string;
}) {
  const { t, language } = useApp();
  const [view, setView] = useState<'cards' | 'table'>(() => {
    try {
      return localStorage.getItem('lanvault-backup-view') === 'table' ? 'table' : 'cards';
    } catch {
      return 'cards';
    }
  });
  const setLayout = (layout: 'cards' | 'table') => {
    setView(layout);
    try {
      localStorage.setItem('lanvault-backup-view', layout);
    } catch {
      // The view still works for this session if storage is unavailable.
    }
  };
  return <section className="surface overflow-hidden">
    <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
      <div><h2 className="text-sm font-bold text-slate-900 dark:text-white">{t('liveBackupJobs')}</h2><p className="mt-0.5 text-[11px] text-slate-500">{pagination?.total ?? backups.length} {t('backupOperations')}</p></div>
      <div className="flex items-center gap-2">
        <span className="hidden items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300 sm:inline-flex"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />{t('live')}</span>
        <div role="group" aria-label={t('backupView')} className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-950">
          <button type="button" aria-pressed={view === 'cards'} title={t('cardView')} onClick={() => setLayout('cards')}
            className={`rounded-lg p-2 transition ${view === 'cards' ? 'bg-white text-orange-600 shadow-sm dark:bg-slate-800 dark:text-orange-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
            <Icon name="dashboard" size={16} />
          </button>
          <button type="button" aria-pressed={view === 'table'} title={t('tableView')} onClick={() => setLayout('table')}
            className={`rounded-lg p-2 transition ${view === 'table' ? 'bg-white text-orange-600 shadow-sm dark:bg-slate-800 dark:text-orange-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
            <Icon name="list" size={16} />
          </button>
        </div>
      </div>
    </header>
    {backups.length === 0 && <EmptyState icon="backups" title={t('noBackups')} description={language === 'ar' ? 'ستظهر هنا النسخ التي يطلبها المسؤول أو سياسة القسم.' : 'Jobs requested by administrators or department policies will appear here.'} />}
    {backups.length > 0 && view === 'cards' && <div className="grid gap-3 p-3 sm:grid-cols-2 xl:grid-cols-3 sm:p-4">
      {backups.map((backup) => <article key={backup.id} className="flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-orange-300 hover:shadow-soft dark:border-slate-800 dark:bg-slate-900 dark:hover:border-orange-800">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-slate-900 dark:text-white">{backup.deviceName ?? backup.deviceId}</h3>
            <p className="mt-1 font-mono text-[10px] text-slate-400">{backup.id.slice(0, 8)}</p>
          </div>
          <StatusBadge value={backup.status} />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">{backup.type === 'full' ? t('fullBackup') : t('incrementalBackup')}</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{formatBytes(backup.sizeBytes, language)}</span>
        </div>
        <div className="mt-4 rounded-xl bg-slate-50 p-3 dark:bg-slate-950/50">
          <BackupProgress backup={backup} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-[10px]">
          <div><p className="text-slate-500">{t('startTime')}</p><p className="mt-1 font-medium text-slate-700 dark:text-slate-300">{formatDate(backup.startedAt ?? backup.createdAt, language)}</p></div>
          <div><p className="text-slate-500">{t('endTime')}</p><p className="mt-1 font-medium text-slate-700 dark:text-slate-300">{formatDate(backup.completedAt, language)}</p></div>
        </div>
        {backup.errorMessage && <p className="mt-3 break-words rounded-lg bg-rose-50 p-2.5 text-xs text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{backup.errorMessage}</p>}
        <div className="mt-auto flex flex-wrap gap-1 border-t border-slate-100 pt-3 dark:border-slate-800">
          <Button variant="ghost" icon="history" className="min-h-8 px-2 text-[11px]" onClick={() => onHistory(backup)}>{t('backupHistory')}</Button>
          {['queued', 'running'].includes(backup.status) && <Button variant="ghost" icon="stop" className="min-h-8 px-2 text-[11px] text-rose-600" disabled={busyId === backup.id} onClick={() => onStop(backup)}>{t('stopBackup')}</Button>}
          {!['queued', 'running', 'cancel_requested'].includes(backup.status) && <Button variant="ghost" icon="trash" className="min-h-8 px-2 text-[11px] text-rose-600" disabled={deletingId === backup.id} onClick={() => onDelete(backup)}>{t('delete')}</Button>}
        </div>
      </article>)}
    </div>}
    {backups.length > 0 && view === 'table' && <div className="table-wrap"><table className="table min-w-[940px] [&_th+th]:border-s [&_th+th]:border-slate-200 [&_td+td]:border-s [&_td+td]:border-slate-100 dark:[&_th+th]:border-slate-800 dark:[&_td+td]:border-slate-800/70">
    <thead className="bg-slate-50/80 dark:bg-slate-950/50"><tr><th className="px-3 py-2.5">{t('computerName')}</th><th className="px-3 py-2.5">{t('type')}</th><th className="px-3 py-2.5">{t('status')}</th><th className="px-3 py-2.5">{t('progress')}</th><th className="px-3 py-2.5">{t('size')}</th><th className="px-3 py-2.5">{t('startTime')} / {t('endTime')}</th><th className="px-3 py-2.5">{t('actions')}</th></tr></thead>
    <tbody>{backups.map((backup) => <tr key={backup.id}>
      <td className="px-3 py-3"><strong className="text-xs">{backup.deviceName ?? backup.deviceId}</strong><span className="mt-1 block font-mono text-[10px] text-slate-400">{backup.id.slice(0, 8)}</span></td>
      <td>{backup.type === 'full' ? t('fullBackup') : t('incrementalBackup')}</td><td><StatusBadge value={backup.status} /></td>
      <td><BackupProgress backup={backup} /></td><td>{formatBytes(backup.sizeBytes, language)}</td>
      <td><span className="block">{formatDate(backup.startedAt ?? backup.createdAt, language)}</span><span className="mt-1 block text-xs text-slate-500">{formatDate(backup.completedAt, language)}</span></td>
      <td><div className="flex flex-wrap gap-1"><Button variant="ghost" icon="history" className="min-h-8 px-2 text-[11px]" onClick={() => onHistory(backup)}>{t('backupHistory')}</Button>{['queued', 'running'].includes(backup.status) && <Button variant="ghost" icon="stop" className="min-h-8 px-2 text-[11px] text-rose-600" disabled={busyId === backup.id} onClick={() => onStop(backup)}>{t('stopBackup')}</Button>}{!['queued', 'running', 'cancel_requested'].includes(backup.status) && <Button variant="ghost" icon="trash" className="min-h-8 px-2 text-[11px] text-rose-600" disabled={deletingId === backup.id} onClick={() => onDelete(backup)}>{t('delete')}</Button>}</div>
      {backup.errorMessage && <p className="mt-2 max-w-[220px] whitespace-normal text-xs text-rose-600">{backup.errorMessage}</p>}</td>
    </tr>)}</tbody>
  </table></div>}
  {backups.length > 0 && pagination && <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={onPage} />}
  </section>;
}
