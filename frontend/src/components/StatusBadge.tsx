import { Icon } from './Icon';
import { useApp } from '../contexts/AppContext';

const statusStyle: Record<string, string> = {
  online: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/45 dark:text-emerald-300',
  connected: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/45 dark:text-emerald-300',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/45 dark:text-emerald-300',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/45 dark:text-emerald-300',
  current: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/45 dark:text-emerald-300',
  healthy: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/45 dark:text-emerald-300',
  running: 'bg-orange-50 text-orange-700 ring-orange-600/15 dark:bg-orange-950/45 dark:text-orange-300',
  busy: 'bg-orange-50 text-orange-700 ring-orange-600/15 dark:bg-orange-950/45 dark:text-orange-300',
  queued: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-950/45 dark:text-amber-300',
  pending: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-950/45 dark:text-amber-300',
  needs_update: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-950/45 dark:text-amber-300',
  offline: 'bg-slate-100 text-slate-600 ring-slate-600/10 dark:bg-slate-800 dark:text-slate-300',
  disconnected: 'bg-slate-100 text-slate-600 ring-slate-600/10 dark:bg-slate-800 dark:text-slate-300',
  inactive: 'bg-slate-100 text-slate-600 ring-slate-600/10 dark:bg-slate-800 dark:text-slate-300',
  failed: 'bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-950/45 dark:text-rose-300',
  deleted: 'bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-950/45 dark:text-rose-300',
  restored: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15 dark:bg-emerald-950/45 dark:text-emerald-300',
  error: 'bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-950/45 dark:text-rose-300',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-950/45 dark:text-rose-300',
  stopped: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-950/45 dark:text-amber-300',
  cancelled: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-950/45 dark:text-amber-300',
  cancel_requested: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-950/45 dark:text-amber-300',
  degraded: 'bg-amber-50 text-amber-700 ring-amber-600/15 dark:bg-amber-950/45 dark:text-amber-300',
  unavailable: 'bg-rose-50 text-rose-700 ring-rose-600/15 dark:bg-rose-950/45 dark:text-rose-300',
  unknown: 'bg-slate-100 text-slate-600 ring-slate-600/10 dark:bg-slate-800 dark:text-slate-300',
};

function labelFor(value: string, translate: (key: never) => string) {
  const labels: Record<string, string> = { online: 'online', offline: 'offline', connected: 'connected', disconnected: 'disconnected', approved: 'approved', pending: 'pending', rejected: 'rejected', completed: 'completed', current: 'agentUpdateCurrent', running: 'running', busy: 'running', queued: 'backupQueued', healthy: 'healthy', degraded: 'degraded', unavailable: 'unavailable', stopped: 'stopBackup', cancelled: 'cancel', cancel_requested: 'backupStopping', inactive: 'offline', failed: 'error', error: 'error', unknown: 'status' };
  const key = labels[value];
  return key ? translate(key as never) : value;
}

export function StatusBadge({ value, label }: { value?: string | null; label?: string }) {
  const { t } = useApp();
  const normalized = (value ?? 'unknown').toLowerCase();
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${statusStyle[normalized] ?? statusStyle.unknown}`}>
    <span className="h-1.5 w-1.5 rounded-full bg-current" />
    {label ?? labelFor(normalized, t as never)}
  </span>;
}
