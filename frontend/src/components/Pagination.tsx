import { Button } from './Button';
import { useApp } from '../contexts/AppContext';

export function Pagination({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (page: number) => void }) {
  const { t } = useApp();
  if (totalPages <= 1) return null;
  return <div className="flex items-center justify-between gap-3 border-t border-slate-100 px-4 py-3 dark:border-slate-800">
    <Button variant="ghost" icon="chevronRight" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>{t('previous')}</Button>
    <span className="text-sm text-slate-500 dark:text-slate-400">{t('page')} {page} {t('of')} {totalPages}</span>
    <Button variant="ghost" icon="chevronLeft" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>{t('next')}</Button>
  </div>;
}
