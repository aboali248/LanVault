import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { navigate } from '../../components/AppShell';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import type { Notification } from '../../types';

export function NotificationsPanel({ notifications, unread, onChange }: {
  notifications: Notification[];
  unread: number;
  onChange: () => void;
}) {
  const { language } = useApp();
  const { notify } = useToast();
  const ar = language === 'ar';
  const markAll = async () => {
    try { await api.markAllNotificationsRead(); onChange(); }
    catch (error) { notify(error instanceof Error ? error.message : (ar ? 'تعذر تحديث التنبيهات' : 'Could not update alerts'), 'error'); }
  };

  return <section className="surface overflow-hidden">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 px-5 py-4">
      <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-xl bg-orange-500/15 text-orange-300"><Icon name="alert" size={18} /></span><div><h2 className="font-bold">{ar ? 'تنبيهات النظام' : 'System alerts'}</h2><p className="mt-0.5 text-xs text-slate-500">{ar ? `${unread} غير مقروء` : `${unread} unread`}</p></div></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => void markAll()} disabled={unread === 0}>{ar ? 'قراءة الكل' : 'Mark all read'}</Button><Button variant="ghost" onClick={() => navigate('/notifications')}>{ar ? 'كل التنبيهات' : 'All alerts'}</Button></div>
    </header>
    {notifications.length === 0
      ? <p className="p-6 text-center text-sm text-slate-400">{ar ? 'لا توجد تنبيهات نشطة' : 'No active alerts'}</p>
      : <ul className="divide-y divide-slate-800">{notifications.slice(0, 6).map((item) => <li key={item.id} className="flex gap-3 px-5 py-3.5">
        <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${item.severity === 'error' ? 'bg-rose-500' : 'bg-orange-400'}`} />
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-200">{item.title}</p><p className="mt-0.5 text-xs text-slate-400">{item.message}</p></div>
        <span className="shrink-0 text-[11px] text-slate-500" dir="ltr">{new Date(item.createdAt).toLocaleString('en-US')}</span>
      </li>)}</ul>}
  </section>;
}
