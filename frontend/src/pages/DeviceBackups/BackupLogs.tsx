import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { Pagination } from '../../components/Pagination';
import { useApp } from '../../contexts/AppContext';
import type { BackupLog, PaginationMeta } from '../../types';
import { formatDate } from '../../utils/format';

export function BackupLogs({ logs, pagination, loading, error, onPage, onRetry, onClear, clearing }: {
  logs: BackupLog[];
  pagination: PaginationMeta;
  loading: boolean;
  error: string;
  onPage: (page: number) => void;
  onRetry: () => void;
  onClear?: () => void;
  clearing?: boolean;
}) {
  const { t, language } = useApp();
  return <div>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-800 dark:bg-slate-950/50">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Icon name="history" size={16} className="text-orange-500" />
        <span>{t('backupLogsHint')}</span>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          {pagination.total} {language === 'ar' ? 'حدث' : 'events'}
        </span>
        {onClear && logs.length > 0 && <Button variant="ghost" icon="trash" className="min-h-8 px-2 text-[11px] text-rose-600" disabled={clearing} onClick={onClear}>{t('clearRunLogs')}</Button>}
      </div>
    </div>
    {error && <div role="alert" className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">
      <span>{error}</span><Button variant="ghost" onClick={onRetry}>{t('retry')}</Button>
    </div>}
    {loading && <p className="py-6 text-center text-sm text-slate-500">{t('loading')}</p>}
    {!loading && !error && logs.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 px-4 py-10 text-center text-sm text-slate-500 dark:border-slate-700">{t('noBackupLogs')}</p>}
    {!loading && logs.length > 0 && <ol className="max-h-[55vh] space-y-2 overflow-y-auto pe-1">
      {logs.map((log) => {
        const isError = log.level === 'error';
        const isWarning = log.level === 'warning';
        const uploaded = log.message.startsWith('Uploaded ');
        const reused = log.message.startsWith('Reused unchanged file ');
        const label = isError ? t('logError') : isWarning ? t('logWarning')
          : uploaded ? t('uploadedFile') : reused ? t('reusedFile') : t('logInfo');
        const tone = isError ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/70 dark:bg-rose-950/25 dark:text-rose-300'
          : isWarning ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/70 dark:bg-amber-950/25 dark:text-amber-300'
            : 'border-slate-200 bg-white text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200';
        return <li key={log.id} className={`rounded-xl border px-3 py-3 ${tone}`}>
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="text-[11px] font-bold">{label}</span>
            <time className="text-[10px] opacity-70" dir="auto">{formatDate(log.createdAt, language)}</time>
          </div>
          <p className="mt-1.5 break-all font-mono text-[11px] leading-relaxed" dir="auto">{log.message}</p>
        </li>;
      })}
    </ol>}
    {!loading && <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={onPage} />}
  </div>;
}
