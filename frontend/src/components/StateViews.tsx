import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { useApp } from '../contexts/AppContext';

export function LoadingState({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-3 p-5" aria-label="Loading">
    {Array.from({ length: rows }).map((_, index) => <div key={index} className="h-12 animate-pulse rounded-xl bg-gradient-to-r from-slate-100 via-slate-200 to-slate-100 bg-[length:200%_100%] dark:from-slate-800 dark:via-slate-700 dark:to-slate-800" />)}
  </div>;
}

export function EmptyState({ icon = 'folder', title, detail, description, action }: { icon?: IconName; title?: string; detail?: string; description?: string; action?: React.ReactNode }) {
  const { t } = useApp();
  return <div className="flex min-h-48 flex-col items-center justify-center px-6 py-10 text-center">
    <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300"><Icon name={icon} size={23} /></span>
    <p className="font-semibold text-slate-700 dark:text-slate-200">{title ?? t('noData')}</p>
    {(detail || description) && <p className="mt-1 max-w-md text-sm text-slate-500 dark:text-slate-400">{detail ?? description}</p>}
    {action && <div className="mt-4">{action}</div>}
  </div>;
}

export function ErrorState({ error, onRetry, compact = false }: { error: Error | string; onRetry?: () => void; compact?: boolean }) {
  const { t } = useApp();
  return <div className={`flex ${compact ? 'min-h-24 flex-row text-right' : 'min-h-48 flex-col text-center'} items-center justify-center gap-3 px-6 py-8`} role="alert">
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300"><Icon name="alert" size={21} /></span>
    <div className={compact ? 'flex-1' : ''}>
      <p className="font-semibold text-slate-700 dark:text-slate-200">{t('actionFailed')}</p>
      <p className="mt-1 text-sm text-rose-700 dark:text-rose-300">{typeof error === 'string' ? error : error.message}</p>
    </div>
    {onRetry && <Button onClick={onRetry} variant="outline" icon="refresh">{t('retry')}</Button>}
  </div>;
}
