import { Button } from '../../components/Button';
import { useApp } from '../../contexts/AppContext';
import type { Device } from '../../types';

export function DeviceActions({ device, busy, onApprove, onReject, onRevoke, onDelete, onUpdateAgent }: {
  device: Device; busy: boolean; onApprove: () => void; onReject: () => void; onRevoke: () => void; onDelete: () => void;
  onUpdateAgent: () => void;
}) {
  const { t } = useApp();
  const updating = ['queued', 'downloading', 'installing'].includes(device.agentUpdateStatus ?? '');
  return <div className="flex flex-wrap items-center gap-1">
    {device.approvalStatus === 'pending' && <>
      <Button variant="secondary" icon="check" className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={onApprove}>{t('approve')}</Button>
      <Button variant="ghost" icon="xCircle" className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={onReject}>{t('reject')}</Button>
    </>}
    {device.approvalStatus === 'approved' && <Button variant="outline" className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={onRevoke}>{t('revoke')}</Button>}
    {device.approvalStatus === 'rejected' && <Button variant="outline" className="min-h-8 px-2.5 text-xs" disabled={busy} onClick={onApprove}>{t('approve')}</Button>}
    {device.agentUpdateAvailable && <Button variant="outline" icon="refresh" className="min-h-8 px-2.5 text-xs" disabled={busy || updating || !device.approved || device.status !== 'online'} onClick={onUpdateAgent}>{t(updating ? 'agentUpdating' : device.agentUpdateStatus === 'failed' ? 'retryAgentUpdate' : 'updateAgent')}</Button>}
    <Button variant="ghost" icon="trash" className="min-h-8 px-2.5 text-xs text-rose-600" disabled={busy} onClick={onDelete}>{t('delete')}</Button>
  </div>;
}
