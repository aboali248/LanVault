import { useCallback } from 'react';
import { PageHeader } from '../../components/PageHeader';
import { Button } from '../../components/Button';
import { ErrorState, LoadingState } from '../../components/StateViews';
import { useApp } from '../../contexts/AppContext';
import { useAsync } from '../../hooks/useAsync';
import { useRealtime } from '../../hooks/useRealtime';
import { api } from '../../services/api';
import { BackupStatus } from './BackupStatus';
import { LatestErrors } from './LatestErrors';
import { RecentBackups } from './RecentBackups';
import { StatsCards } from './StatsCards';
import type { RealtimeEvent } from '../../types';
import { NotificationsPanel } from './NotificationsPanel';

export function Dashboard() {
  const { t } = useApp();
  const load = useCallback(() => api.getDashboard(), []);
  const { data, error, loading, reload } = useAsync(load, [load]);
  useRealtime(useCallback((event: RealtimeEvent) => {
    if (['backup.progress', 'backup.completed', 'backup.failed', 'device.status', 'notification.created', 'notification.updated'].includes(event.type)) void reload();
  }, [reload]));

  return <>
    <PageHeader icon="dashboard" title={t('dashboard')} description={t('overview')} actions={<Button variant="outline" icon="refresh" onClick={() => void reload()} loading={loading}>{t('refresh')}</Button>} />
    {error && !data ? <ErrorState error={error} onRetry={() => void reload()} /> : <div className="space-y-5 animate-fade-up">
      <StatsCards stats={data?.stats} loading={loading && !data} />
      {loading && !data ? <LoadingState rows={4} /> : <BackupStatus storage={data?.storage} system={data?.system} loading={false} />}
      <div className="grid gap-5 xl:grid-cols-[1.35fr_.85fr]"><RecentBackups backups={data?.recentBackups} /><LatestErrors errors={data?.errors} /></div>
      <NotificationsPanel notifications={data?.notifications ?? []} unread={data?.unreadNotifications ?? 0} onChange={() => void reload()} />
      {error && <ErrorState compact error={error} onRetry={() => void reload()} />}
    </div>}
  </>;
}
