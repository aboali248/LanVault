import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { StatusBadge } from '../../components/StatusBadge';
import { Pagination } from '../../components/Pagination';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import type { Backup, BackupTreeFile, PaginationMeta } from '../../types';
import { formatBytes, formatDate } from '../../utils/format';

const filesPageSize = 20;

export function BackupHistory({ backups, pagination, onPage, onDelete, deletingId }: { backups: Backup[]; pagination?: PaginationMeta; onPage: (page: number) => void; onDelete?: (backup: Backup) => void; deletingId?: string }) {
  const { t, language } = useApp();
  const { notify } = useToast();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [files, setFiles] = useState<BackupTreeFile[]>([]);
  const [filesPagination, setFilesPagination] = useState<PaginationMeta>({ page: 1, pageSize: filesPageSize, total: 0, totalPages: 0 });
  const [filesPage, setFilesPage] = useState(1);
  const [search, setSearch] = useState('');
  const [appliedSearch, setAppliedSearch] = useState('');
  const [loadingFiles, setLoadingFiles] = useState(false);

  useEffect(() => { setExpandedId(null); }, [backups]);

  const loadFiles = useCallback(async (backup: Backup, page: number, query: string) => {
    setLoadingFiles(true);
    try {
      const result = await api.listBackupFiles(backup.deviceId, backup.id, { search: query || undefined, page, pageSize: filesPageSize });
      setFiles(result.items);
      setFilesPagination(result.pagination);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error');
    } finally {
      setLoadingFiles(false);
    }
  }, [notify, t]);

  const toggle = (backup: Backup) => {
    if (expandedId === backup.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(backup.id);
    setFilesPage(1);
    setSearch('');
    setAppliedSearch('');
    void loadFiles(backup, 1, '');
  };

  const changeFilesPage = (backup: Backup, page: number) => {
    setFilesPage(page);
    void loadFiles(backup, page, appliedSearch);
  };

  const submitSearch = (backup: Backup, event: React.FormEvent) => {
    event.preventDefault();
    setAppliedSearch(search);
    setFilesPage(1);
    void loadFiles(backup, 1, search);
  };

  const goPage = (page: number) => {
    setExpandedId(null);
    onPage(page);
  };

  return <div className="space-y-3">{backups.length ? backups.map((backup) => {
    const expanded = expandedId === backup.id;
    return <article key={backup.id} className="surface-muted overflow-hidden">
      <div className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="font-semibold">{backup.type === 'full' ? t('fullBackup') : t('incrementalBackup')}</p><p className="mt-1 text-xs text-slate-500">{formatDate(backup.createdAt, language)}</p></div><StatusBadge value={backup.status} /></div>
        <div className="mt-3 grid grid-cols-2 gap-3 text-xs"><span>{t('size')}: {formatBytes(backup.sizeBytes, language)}</span><span>{t('endTime')}: {formatDate(backup.completedAt, language)}</span></div>
        {backup.errorMessage && <p className="mt-2 text-xs text-rose-600">{backup.errorMessage}</p>}
        <div className="mt-3 flex flex-wrap gap-1">
          <Button variant="ghost" icon={expanded ? 'chevronDown' : 'chevronLeft'} className="min-h-8 px-2 text-[11px]" onClick={() => toggle(backup)}>
            {expanded ? t('hideFiles') : `${t('showFiles')} · ${t('backupFiles')}`}
          </Button>
          {onDelete && !['queued', 'running', 'cancel_requested'].includes(backup.status) && <Button variant="ghost" icon="trash" className="min-h-8 px-2 text-[11px] text-rose-600" disabled={deletingId === backup.id} onClick={() => onDelete(backup)}>{t('delete')}</Button>}
        </div>
      </div>
      {expanded && <div className="border-t border-slate-200 p-4 dark:border-slate-800">
        <form onSubmit={(event) => submitSearch(backup, event)} className="mb-3 flex gap-2">
          <label className="relative min-w-0 flex-1">
            <Icon name="search" size={15} className="pointer-events-none absolute start-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('searchFiles')} className="input min-h-9 ps-9 text-xs" aria-label={t('searchFiles')} />
          </label>
          <Button type="submit" variant="outline" className="min-h-9 px-3 text-xs" disabled={loadingFiles}>{t('search')}</Button>
        </form>
        {loadingFiles && files.length === 0
          ? <p className="py-6 text-center text-xs text-slate-500">{t('loading')}</p>
          : files.length === 0
            ? <p className="py-6 text-center text-xs text-slate-500">{t('noFilesFound')}</p>
            : <ul className="max-h-72 space-y-1.5 overflow-y-auto">
              {files.map((file) => <li key={`${file.drive}:${file.relativePath}`} className="flex min-w-0 items-center gap-2.5 rounded-xl bg-slate-100/70 px-3 py-2 dark:bg-slate-950/50">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400"><Icon name="folder" size={14} /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-slate-700 dark:text-slate-200" title={file.relativePath}>{file.name}</span>
                  <code dir="ltr" className="block truncate text-left text-[10px] text-slate-500">{file.drive}:\{file.relativePath}</code>
                </span>
                <span dir="ltr" className="shrink-0 text-[10px] text-slate-500">{formatBytes(file.sizeBytes, language)}</span>
              </li>)}
            </ul>}
        {filesPagination.totalPages > 1 && <div className="mt-3 flex items-center justify-between text-[11px] text-slate-500">
          <span>{t('page')} {filesPagination.page} {t('of')} {filesPagination.totalPages} · {filesPagination.total}</span>
          <div className="flex gap-1.5">
            <Button variant="outline" className="min-h-7 px-2 text-[11px]" disabled={filesPage <= 1 || loadingFiles} onClick={() => changeFilesPage(backup, filesPage - 1)}>{t('previous')}</Button>
            <Button variant="outline" className="min-h-7 px-2 text-[11px]" disabled={filesPage >= filesPagination.totalPages || loadingFiles} onClick={() => changeFilesPage(backup, filesPage + 1)}>{t('next')}</Button>
          </div>
        </div>}
      </div>}
    </article>;
  }) : <p className="py-8 text-center text-sm text-slate-500">{t('noBackups')}</p>}
    {pagination && <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={goPage} />}
  </div>;
}
