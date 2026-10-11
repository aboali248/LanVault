import { EmptyState } from '../../components/StateViews';
import { Icon } from '../../components/Icon';
import { useApp } from '../../contexts/AppContext';
import type { SystemError } from '../../types';
import { formatRelative } from '../../utils/format';

export function LatestErrors({ errors }: { errors?: SystemError[] }) {
  const { t, language } = useApp();
  return <section className="surface overflow-hidden"><div className="flex items-center justify-between px-5 py-4"><div><h2 className="font-bold text-slate-800 dark:text-white">{t('latestErrors')}</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t('systemStatus')}</p></div><span className="grid h-9 w-9 place-items-center rounded-xl bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300"><Icon name="alert" size={19} /></span></div>
    {!errors?.length ? <EmptyState icon="check" title={language === 'ar' ? 'لا توجد أخطاء مسجلة' : 'No errors recorded'} /> : <ul className="divide-y divide-slate-100 dark:divide-slate-800">{errors.map((item) => <li key={item.id} className="flex gap-3 px-5 py-3.5"><span className={`mt-0.5 h-2 w-2 shrink-0 rounded-full ${item.severity === 'error' ? 'bg-rose-500' : item.severity === 'warning' ? 'bg-amber-500' : 'bg-orange-500'}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-700 dark:text-slate-200">{item.title}</p><p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{item.message}</p></div><span className="shrink-0 text-[11px] text-slate-400">{formatRelative(item.createdAt, language)}</span></li>)}</ul>}
  </section>;
}
