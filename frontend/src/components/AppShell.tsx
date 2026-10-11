import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from '../contexts/AppContext';
import { Icon, type IconName } from './Icon';
import { useRealtime } from '../hooks/useRealtime';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { api } from '../services/api';
import type { Notification, RealtimeEvent } from '../types';

export type RouteKey = 'dashboard' | 'devices' | 'backups' | 'browse' | 'restore' | 'groups' | 'settings' | 'notifications' | 'login' | 'setup';

function isDeletedFilesNotification(payload: unknown): payload is { type: 'files_deleted'; title: string; message: string } {
  return typeof payload === 'object' && payload !== null &&
    'type' in payload && payload.type === 'files_deleted' &&
    'title' in payload && typeof payload.title === 'string' &&
    'message' in payload && typeof payload.message === 'string';
}

const links: Array<{ key: Exclude<RouteKey, 'login' | 'setup'>; path: string; icon: IconName }> = [
  { key: 'dashboard', path: '/', icon: 'dashboard' },
  { key: 'devices', path: '/devices', icon: 'devices' },
  { key: 'backups', path: '/backups', icon: 'backups' },
  { key: 'browse', path: '/browse', icon: 'folder' },
  { key: 'restore', path: '/restore', icon: 'history' },
  { key: 'groups', path: '/groups', icon: 'groups' },
  { key: 'notifications', path: '/notifications', icon: 'alert' },
  { key: 'settings', path: '/settings', icon: 'settings' },
];

export function navigate(path: string) {
  if (`${window.location.pathname}${window.location.search}` === path) return;
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function useRoute(): RouteKey {
  const find = () => window.location.pathname === '/login' ? 'login'
    : window.location.pathname === '/setup' ? 'setup'
      : links.find((item) => item.path === window.location.pathname)?.key ?? 'dashboard';
  const [route, setRoute] = useState<RouteKey>(find);
  useEffect(() => {
    const sync = () => setRoute(find());
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  return route;
}

export function AppShell({ children, route }: { children: React.ReactNode; route: RouteKey }) {
  const [open, setOpen] = useState(false);
  const { language, setLanguage, t } = useApp();
  const { signOut } = useAuth();
  const { notify } = useToast();
  const [pendingDeviceCount, setPendingDeviceCount] = useState(0);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const notifRef = useRef<HTMLDivElement>(null);
  const ar = language === 'ar';
  const loadPendingDevices = useCallback(async () => {
    try {
      const result = await api.listDevices({ page: 1, pageSize: 1, approval: 'pending' });
      setPendingDeviceCount(result.pagination.total);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error');
    }
  }, [notify, t]);
  useEffect(() => { void loadPendingDevices(); }, [loadPendingDevices, route]);
  const loadNotifications = useCallback(async () => {
    try {
      const result = await api.listNotifications(false);
      setNotifications(result.items.slice(0, 8));
      setUnreadCount(result.unread);
    } catch {
      // Navbar stays quiet on failure; the full page surfaces errors.
    }
  }, []);
  useEffect(() => { void loadNotifications(); }, [loadNotifications, route]);
  useEffect(() => { setNotifOpen(false); }, [route]);
  useEffect(() => {
    if (!notifOpen) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !notifRef.current?.contains(event.target)) setNotifOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setNotifOpen(false); };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [notifOpen]);
  const handleRealtime = useCallback((event: RealtimeEvent) => {
    if (['device.created', 'device.updated', 'device.deleted'].includes(event.type)) {
      void loadPendingDevices();
    }
    if (event.type === 'notification.created' || event.type === 'notification.updated' || event.type === 'notification.deleted') {
      void loadNotifications();
    }
    if (event.type === 'notification.created' && isDeletedFilesNotification(event.payload)) {
      notify(`${event.payload.title}: ${event.payload.message}`, 'info');
    }
  }, [loadPendingDevices, loadNotifications, notify]);
  const socketState = useRealtime(handleRealtime);
  const isConnected = socketState === 'connected';

  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };
  const toggleNotif = () => {
    setNotifOpen((current) => {
      if (!current) void loadNotifications();
      return !current;
    });
  };
  const markNotifRead = async (id: string) => {
    try { await api.markNotificationRead(id); await loadNotifications(); }
    catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
  };
  const markAllNotifRead = async () => {
    try { await api.markAllNotificationsRead(); await loadNotifications(); }
    catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
  };
  const deleteNotif = async (id: string) => {
    try { await api.deleteNotification(id); await loadNotifications(); }
    catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
  };

  return <div className="min-h-screen bg-[#09090b] text-slate-100">
    {open && <button type="button" onClick={() => setOpen(false)} className="fixed inset-0 z-30 bg-slate-950/40 lg:hidden" aria-label={t('close')} />}
    <aside className={`fixed inset-y-0 z-40 flex w-[17.5rem] flex-col border-l border-slate-200/80 bg-white px-4 py-5 shadow-float transition-transform dark:border-slate-800 dark:bg-slate-950 lg:translate-x-0 ${open ? 'translate-x-0' : language === 'en' ? '-translate-x-full' : 'translate-x-full'} ${language === 'en' ? 'right-auto left-0 border-r border-l-0' : 'right-0'}`}>
      <div className="mb-9 flex items-center gap-3 px-2">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow-lg shadow-orange-600/20"><Icon name="shield" size={22} /></span>
        <div><strong className="block text-lg tracking-tight">LanVault</strong><span className="text-xs text-slate-500 dark:text-slate-400">LAN backup control</span></div>
      </div>
      <nav className="space-y-1.5" aria-label="Primary navigation">
        {links.map((item) => <button key={item.key} type="button" onClick={() => go(item.path)} aria-label={item.key === 'devices' && pendingDeviceCount > 0 ? `${t(item.key)} (${pendingDeviceCount} ${t('pending')})` : t(item.key)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${route === item.key ? 'bg-gradient-to-l from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-600/20' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-900'}`}>
          <Icon name={item.icon} size={19} /><span>{t(item.key)}</span>
          {item.key === 'devices' && pendingDeviceCount > 0 && <span className="ms-auto min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white">{pendingDeviceCount > 99 ? '99+' : pendingDeviceCount}</span>}
        </button>)}
      </nav>
      <div className="mt-auto rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900/70">
        <div className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300"><span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} /><span>{isConnected ? t('live') : t('connectionLost')}</span></div>
        <p className="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{isConnected ? t('connected') : t('disconnected')}</p>
      </div>
    </aside>
    <div className={`${language === 'en' ? 'lg:pl-[17.5rem]' : 'lg:pr-[17.5rem]'} min-h-screen`}>
      <header className="sticky top-0 z-20 flex h-[4.5rem] items-center justify-between border-b border-slate-800/70 bg-[#09090b]/85 px-4 backdrop-blur-md sm:px-7">
        <button type="button" onClick={() => setOpen(true)} className="grid h-10 w-10 place-items-center rounded-xl text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900 lg:hidden" aria-label="Menu"><Icon name="menu" /></button>
        <div className="hidden items-center gap-2 text-xs text-slate-500 sm:flex"><Icon name="network" size={15} /><span>LAN / Backup Console</span></div>
        <div className="flex items-center gap-1.5">
          <div ref={notifRef} className="relative">
            <button
              type="button"
              onClick={toggleNotif}
              aria-label={t('notifications')}
              aria-expanded={notifOpen}
              className={`relative grid h-10 w-10 place-items-center rounded-xl transition ${notifOpen ? 'bg-orange-500/15 text-orange-300' : 'text-slate-300 hover:bg-white hover:text-slate-600 dark:text-slate-300 dark:hover:bg-slate-900'}`}
            >
              <Icon name="bell" size={19} />
              {unreadCount > 0 && <span className="absolute right-1 top-1 min-w-4 rounded-full bg-rose-500 px-1 text-center text-[10px] font-bold leading-4 text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
            </button>
            {notifOpen && <div className="absolute end-0 top-[calc(100%+0.5rem)] z-50 w-[min(92vw,380px)] overflow-hidden rounded-2xl border border-white/10 bg-[#141416]/95 shadow-2xl shadow-black/60 ring-1 ring-white/10 backdrop-blur-xl animate-fade-up">
              <header className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-3">
                <div className="flex min-w-0 items-center gap-2">
                  <h2 className="truncate text-sm font-bold text-slate-100">{t('notifications')}</h2>
                  {unreadCount > 0 && <span className="min-w-5 rounded-full bg-rose-500 px-1.5 py-0.5 text-center text-[10px] font-bold leading-4 text-white">{unreadCount > 99 ? '99+' : unreadCount}</span>}
                </div>
                <button type="button" onClick={() => void markAllNotifRead()} disabled={!unreadCount} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-bold text-orange-300 hover:bg-orange-500/10 disabled:opacity-40">{ar ? 'قراءة الكل' : 'Mark all read'}</button>
              </header>
              <div className="max-h-96 overflow-y-auto p-2">
                {notifications.length === 0
                  ? <p className="px-3 py-8 text-center text-xs text-slate-500">{ar ? 'لا توجد تنبيهات نشطة' : 'No active alerts'}</p>
                  : notifications.map((item) => <div key={item.id} className={`mb-1 flex gap-2.5 rounded-xl p-3 last:mb-0 ${item.readAt ? '' : 'bg-orange-500/[0.07]'}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.severity === 'error' ? 'bg-rose-500' : 'bg-orange-400'}`} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-bold text-slate-200" title={item.title}>{item.title}</p>
                      <p className="mt-0.5 line-clamp-2 break-words text-xs leading-5 text-slate-400" title={item.message}>{item.message}</p>
                      <time dir="ltr" className="mt-1 block text-[10px] text-slate-500">{new Date(item.createdAt).toLocaleString('en-US')}</time>
                    </div>
                    {!item.readAt && <button type="button" onClick={() => void markNotifRead(item.id)} aria-label={ar ? 'تمت القراءة' : 'Mark read'} title={ar ? 'تمت القراءة' : 'Mark read'} className="grid h-7 w-7 shrink-0 place-items-center self-center rounded-lg text-slate-500 hover:bg-white/10 hover:text-orange-300"><Icon name="check" size={14} /></button>}
                    <button type="button" onClick={() => void deleteNotif(item.id)} aria-label={ar ? 'حذف التنبيه' : 'Delete alert'} title={ar ? 'حذف التنبيه' : 'Delete alert'} className="grid h-7 w-7 shrink-0 place-items-center self-center rounded-lg text-slate-500 hover:bg-rose-500/10 hover:text-rose-300"><Icon name="trash" size={14} /></button>
                  </div>)}
              </div>
              <footer className="border-t border-white/10 p-2">
                <button type="button" onClick={() => go('/notifications')} className="w-full rounded-xl px-3 py-2.5 text-center text-xs font-bold text-orange-300 transition hover:bg-orange-500/10">{ar ? 'عرض كل التنبيهات' : 'View all alerts'}</button>
              </footer>
            </div>}
          </div>
          <button type="button" onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')} className="rounded-xl px-3 py-2 text-xs font-bold text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-900">{language === 'ar' ? 'EN' : 'ع'}</button>
            <span className="mx-1 h-7 w-px bg-slate-800" />
            <button type="button" onClick={signOut} className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 hover:border-orange-400 hover:text-orange-300">{language === 'ar' ? 'خروج' : 'Sign out'}</button>
        </div>
      </header>
      <main className="mx-auto max-w-[1536px] px-4 py-7 sm:px-7 lg:px-9">{children}</main>
    </div>
  </div>;
}
