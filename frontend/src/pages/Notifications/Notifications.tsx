import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { Select } from '../../components/Select';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import type { Device, Notification } from '../../types';

const GENERAL_FILTER = '__general__';

export function Notifications() {
  const { language } = useApp();
  const { notify } = useToast();
  const ar = language === 'ar';
  const [items, setItems] = useState<Notification[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [deviceFilter, setDeviceFilter] = useState('');
  const [unread, setUnread] = useState(0);
  const [includeResolved, setIncludeResolved] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await api.listNotifications(includeResolved, deviceFilter === GENERAL_FILTER
        ? { unassigned: true }
        : deviceFilter ? { deviceId: deviceFilter } : {});
      setItems(result.items); setUnread(result.unread);
    } catch (error) { notify(error instanceof Error ? error.message : (ar ? 'تعذر تحميل التنبيهات' : 'Could not load alerts'), 'error'); }
    finally { setLoading(false); }
  }, [includeResolved, deviceFilter, ar, notify]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    api.listDevices({ page: 1, pageSize: 100 }).then((result) => setDevices(result.items)).catch(() => undefined);
  }, []);

  const markRead = async (id: string) => {
    try { await api.markNotificationRead(id); await load(); }
    catch (error) { notify(error instanceof Error ? error.message : (ar ? 'تعذر تحديث التنبيه' : 'Could not update alert'), 'error'); }
  };
  const markAll = async () => {
    try { await api.markAllNotificationsRead(); await load(); }
    catch (error) { notify(error instanceof Error ? error.message : (ar ? 'تعذر تحديث التنبيهات' : 'Could not update alerts'), 'error'); }
  };
  const removeOne = async (id: string) => {
    try { await api.deleteNotification(id); await load(); }
    catch (error) { notify(error instanceof Error ? error.message : (ar ? 'تعذر حذف التنبيه' : 'Could not delete alert'), 'error'); }
  };
  const removeAll = async () => {
    if (!window.confirm(ar ? 'حذف كل التنبيهات؟ لا يمكن التراجع.' : 'Delete all alerts? This cannot be undone.')) return;
    try { await api.deleteAllNotifications(); await load(); }
    catch (error) { notify(error instanceof Error ? error.message : (ar ? 'تعذر حذف التنبيهات' : 'Could not delete alerts'), 'error'); }
  };

  return <>
    <PageHeader icon="alert" title={ar ? 'التنبيهات' : 'Alerts'} description={ar ? `${unread} تنبيه غير مقروء` : `${unread} unread alerts`} actions={<>
      <Button variant="outline" onClick={() => void markAll()} disabled={!unread}>{ar ? 'قراءة الكل' : 'Mark all read'}</Button>
      <Button variant="outline" icon="trash" className="text-rose-300" onClick={() => void removeAll()} disabled={!items.length}>{ar ? 'حذف الكل' : 'Delete all'}</Button>
      <Button variant="outline" icon="refresh" onClick={() => void load()} loading={loading}>{ar ? 'تحديث' : 'Refresh'}</Button>
    </>} />
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
      <label className="flex items-center gap-2 text-sm text-slate-300"><input type="checkbox" checked={includeResolved} onChange={(event) => setIncludeResolved(event.target.checked)} className="accent-orange-500" />{ar ? 'عرض التنبيهات المحلولة أيضًا' : 'Include resolved alerts'}</label>
      <Select
        className="sm:max-w-xs sm:flex-1"
        value={deviceFilter}
        onValueChange={(value) => setDeviceFilter(value)}
        searchable
        options={[
          { value: '', label: ar ? 'كل الأجهزة' : 'All devices' },
          { value: GENERAL_FILTER, label: ar ? 'عامة (بدون جهاز)' : 'General (no device)' },
          ...devices.map((device) => ({ value: device.id, label: device.computerName })),
        ]}
        ariaLabel={ar ? 'تصفية حسب الجهاز' : 'Filter by device'}
      />
    </div>
    <section className="surface divide-y divide-slate-800 overflow-hidden">
      {loading && <p className="p-5 text-sm text-slate-400">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}
      {!loading && items.length === 0 && <p className="p-8 text-center text-sm text-slate-400">{ar ? 'لا توجد تنبيهات' : 'No alerts'}</p>}
      {items.map((item) => <article key={item.id} className={`flex flex-col gap-3 p-4 sm:flex-row sm:items-start ${item.readAt ? 'opacity-75' : ''}`}>
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${item.severity === 'error' ? 'bg-rose-500' : 'bg-orange-400'}`} />
        <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h2 className="font-bold">{item.title}</h2>{!item.readAt && <span className="rounded-full bg-orange-500/15 px-2 py-0.5 text-[10px] font-semibold text-orange-300">{ar ? 'جديد' : 'New'}</span>}{item.resolvedAt && <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">{ar ? 'تم الحل' : 'Resolved'}</span>}</div><p className="mt-1 break-words text-sm text-slate-400">{item.message}</p><time className="mt-2 block text-[11px] text-slate-500" dir="ltr">{new Date(item.createdAt).toLocaleString('en-US')}</time></div>
        <div className="flex shrink-0 items-center gap-1.5">
          {!item.readAt && <Button variant="outline" onClick={() => void markRead(item.id)}>{ar ? 'تمت القراءة' : 'Mark read'}</Button>}
          <button type="button" onClick={() => void removeOne(item.id)} aria-label={ar ? 'حذف التنبيه' : 'Delete alert'} title={ar ? 'حذف التنبيه' : 'Delete alert'} className="grid h-9 w-9 place-items-center rounded-xl text-slate-500 transition hover:bg-rose-500/10 hover:text-rose-300"><Icon name="trash" size={16} /></button>
        </div>
      </article>)}
    </section>
  </>;
}
