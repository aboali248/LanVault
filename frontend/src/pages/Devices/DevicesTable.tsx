import { useState } from 'react';
import { Pagination } from '../../components/Pagination';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import type { Device, PaginationMeta } from '../../types';
import { DeviceActions } from './DeviceActions';
import { DeviceDetails } from './DeviceDetails';
import { useApp } from '../../contexts/AppContext';

// The device status badge already says "connected"/"disconnected" — hide the
// agent badge when it would only repeat the same word.
function showAgentBadge(device: Device) {
  if (device.agentStatus === 'connected' && (device.status === 'online' || device.status === 'busy')) return false;
  if (device.agentStatus === 'disconnected' && device.status === 'offline') return false;
  return true;
}

export function DevicesTable({ devices, pagination, busyId, savingId, onPage, onAction, onUpdateAgent, onToggleDisk }: {
  devices: Device[]; pagination?: PaginationMeta; busyId?: string; savingId?: string;
  onPage: (page: number) => void;
  onAction: (action: 'approve' | 'reject' | 'revoke' | 'delete', device: Device) => void;
  onUpdateAgent: (device: Device) => void;
  onToggleDisk: (device: Device, diskId: string, selected: boolean) => void;
}) {  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
  const [view, setView] = useState<'cards' | 'table'>('cards');
  const selectedDevice = devices.find((device) => device.id === selectedDeviceId) ?? null;
  const { t } = useApp();
  return <section className="surface overflow-hidden">
    <header className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-3 dark:border-slate-800 sm:px-5">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-300"><Icon name="devices" size={18} /></span>
      <div className="min-w-0 flex-1">
        <h2 className="text-sm font-bold text-slate-900 dark:text-white">{t('deviceInventory')}</h2>
        <p className="mt-0.5 truncate text-[11px] text-slate-500">{t('deviceInventoryHint')}</p>
      </div>
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-300" dir="ltr">
        {devices.length} / {pagination?.total ?? devices.length}
      </span>
      <div role="group" aria-label={t('deviceView')} className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-950">
        <button type="button" aria-pressed={view === 'cards'} title={t('cardView')} onClick={() => setView('cards')}
          className={`rounded-lg p-2 transition ${view === 'cards' ? 'bg-white text-orange-600 shadow-sm dark:bg-slate-800 dark:text-orange-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
          <Icon name="dashboard" size={16} />
        </button>
        <button type="button" aria-pressed={view === 'table'} title={t('tableView')} onClick={() => setView('table')}
          className={`rounded-lg p-2 transition ${view === 'table' ? 'bg-white text-orange-600 shadow-sm dark:bg-slate-800 dark:text-orange-300' : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
          <Icon name="list" size={16} />
        </button>
      </div>
    </header>
    {devices.length > 0 && view === 'cards' && <div className="grid gap-2.5 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-4">
      {devices.map((device) => <DeviceCard key={device.id} device={device} busy={busyId === device.id}
        onShowDetails={() => setSelectedDeviceId(device.id)}
        onAction={(action) => onAction(action, device)} onUpdateAgent={() => onUpdateAgent(device)} />)}
    </div>}
    {devices.length > 0 && view === 'table' && <div className="table-wrap">
      <table className="table min-w-[980px] [&_th+th]:border-s [&_th+th]:border-slate-200 [&_td+td]:border-s [&_td+td]:border-slate-100 dark:[&_th+th]:border-slate-800 dark:[&_td+td]:border-slate-800/70">
        <thead className="bg-slate-50/80 dark:bg-slate-950/50">
          <tr><th className="px-3 py-2">{t('computerName')}</th><th className="px-3 py-2">{t('ipAddress')}</th><th className="px-3 py-2">{t('department')}</th><th className="px-3 py-2">{t('status')}</th><th className="px-3 py-2">{t('approved')}</th><th className="px-3 py-2">{t('agent')}</th><th className="px-3 py-2">{t('disks')}</th><th className="px-3 py-2">{t('actions')}</th></tr>
        </thead>
        <tbody>{devices.map((device) => <DeviceRow key={device.id} device={device} busy={busyId === device.id} onShowDetails={() => setSelectedDeviceId(device.id)} onAction={(action) => onAction(action, device)} onUpdateAgent={() => onUpdateAgent(device)} />)}</tbody>
      </table>
    </div>}
    {devices.length === 0 && <div className="grid justify-items-center px-6 py-12 text-center">
      <span className="mb-3 grid h-14 w-14 place-items-center rounded-2xl bg-slate-100 text-slate-500 dark:bg-slate-800"><Icon name="devices" size={25} /></span>
      <p className="font-semibold text-slate-800 dark:text-slate-200">{t('noDevices')}</p>
      <p className="mt-1 text-xs text-slate-500">{t('deviceInventoryEmptyHint')}</p>
    </div>}
    {pagination && <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={onPage} />}
    <Modal open={selectedDevice !== null} onClose={() => setSelectedDeviceId(null)} title={`${t('deviceDetails')}${selectedDevice ? ` · ${selectedDevice.computerName}` : ''}`} size="xl">
      {selectedDevice && <DeviceDetails device={selectedDevice} saving={savingId === selectedDevice.id} onToggleDisk={(diskId, selected) => onToggleDisk(selectedDevice, diskId, selected)} />}
    </Modal>
  </section>;
}

function DeviceCard({ device, busy, onShowDetails, onAction, onUpdateAgent }: {
  device: Device; busy: boolean; onShowDetails: () => void;
  onAction: (action: 'approve' | 'reject' | 'revoke' | 'delete') => void;
  onUpdateAgent: () => void;
}) {
  const { t } = useApp();
  const selectedDisks = device.disks.filter((disk) => disk.selectedForBackup).length;
  return <article className="group flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white p-3 transition hover:border-orange-300 hover:shadow-soft dark:border-slate-800 dark:bg-slate-900 dark:hover:border-orange-800">
    <div className="flex min-w-0 items-center justify-between gap-2">
      <button type="button" onClick={onShowDetails} className="flex min-w-0 flex-1 items-center gap-2.5 text-start">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 text-base font-black text-white shadow-sm">
          {device.computerName.trim().charAt(0).toUpperCase() || '?'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-slate-900 group-hover:text-orange-600 dark:text-white">{device.computerName}</span>
          <span className="mt-0.5 block truncate font-mono text-[10px] text-slate-500" dir="ltr">{device.ipAddress || '—'}</span>
        </span>
      </button>
      <button type="button" onClick={onShowDetails} aria-label={`${t('deviceDetails')}: ${device.computerName}`}
        className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-orange-600 dark:hover:bg-slate-800">
        <Icon name="arrowUpRight" size={15} />
      </button>
    </div>
    <div className="mt-2.5 flex flex-wrap gap-1">
      <StatusBadge value={device.status} />
      <StatusBadge value={device.approvalStatus} />
      {device.agentUpdateAvailable && <StatusBadge value="needs_update" label={t('agentUpdateAvailable')} />}
    </div>
    <div className="mt-2.5 grid grid-cols-3 gap-1.5 text-center">
      <div className="min-w-0 rounded-lg bg-slate-50 px-1.5 py-1.5 dark:bg-slate-950/60">
        <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400">{t('agent')}</p>
        <p className="mt-0.5 truncate text-[11px] font-bold text-slate-700 dark:text-slate-200" dir="ltr">{device.agentVersion ? `v${device.agentVersion}` : '—'}</p>
      </div>
      <div className="min-w-0 rounded-lg bg-slate-50 px-1.5 py-1.5 dark:bg-slate-950/60">
        <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400">{t('disks')}</p>
        <p className="mt-0.5 text-[11px] font-bold text-slate-700 dark:text-slate-200" dir="ltr">{selectedDisks}/{device.disks.length}</p>
      </div>
      <div className="min-w-0 rounded-lg bg-slate-50 px-1.5 py-1.5 dark:bg-slate-950/60">
        <p className="truncate text-[9px] font-semibold uppercase tracking-wide text-slate-400">{t('department')}</p>
        <p className="mt-0.5 truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">{device.group?.name || t('unassigned')}</p>
      </div>
    </div>
    {(device.agentUpdateStatus || device.agentUpdateError) && <div className="mt-2 rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-950/60">
      {device.agentUpdateStatus && (device.agentUpdateStatus === 'current'
        ? <StatusBadge value="current" />
        : <p className={`inline-flex items-center gap-1 text-[10px] font-semibold ${device.agentUpdateStatus === 'failed' ? 'text-rose-500' : 'text-orange-500'}`}>
          {device.agentUpdateStatus !== 'failed' && <Icon name="refresh" size={10} />}
          {t(device.agentUpdateStatus === 'failed' ? 'agentUpdateFailed'
            : device.agentUpdateStatus === 'queued' ? 'agentUpdateQueued'
              : device.agentUpdateStatus === 'downloading' ? 'agentUpdateDownloading'
                : 'agentUpdateInstalling')}
        </p>)}
      {device.agentUpdateError && <p className="mt-0.5 break-words text-[10px] text-rose-500">{device.agentUpdateError}</p>}
    </div>}
    <div className="mt-2.5 border-t border-slate-100 pt-2.5 dark:border-slate-800">
      <DeviceActions device={device} busy={busy} onUpdateAgent={onUpdateAgent}
        onApprove={() => onAction('approve')} onReject={() => onAction('reject')}
        onRevoke={() => onAction('revoke')} onDelete={() => onAction('delete')} />
    </div>
  </article>;
}

function DeviceRow({ device, busy, onShowDetails, onAction, onUpdateAgent }: {
  device: Device; busy: boolean; onShowDetails: () => void;
  onAction: (action: 'approve' | 'reject' | 'revoke' | 'delete') => void;
  onUpdateAgent: () => void;
}) {
  const { t } = useApp();
  return <tr>
      <td className="px-3 py-2">
        <button type="button" aria-label={`${t('deviceDetails')}: ${device.computerName}`} onClick={onShowDetails} className="group flex max-w-[220px] items-center gap-2 text-start">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-slate-200 bg-white text-orange-500 dark:border-slate-700 dark:bg-slate-900">
            <Icon name="desktop" size={16} />
          </span>
          <span className="min-w-0">
            <span className="block truncate text-xs font-bold text-slate-900 group-hover:text-orange-500 dark:text-slate-100">{device.computerName}</span>
            <span className="mt-0.5 block truncate text-[10px] text-slate-500">{device.windowsUsername || t('unknownUser')}</span>
          </span>
          <Icon name="chevronLeft" size={13} className="shrink-0 text-slate-400" />
        </button>
      </td>
      <td dir="ltr" className="px-3 py-2 text-left"><span className="font-mono text-[11px] text-slate-600 dark:text-slate-300">{device.ipAddress || '—'}</span></td>
      <td className="px-3 py-2"><span className="inline-flex items-center gap-1.5 text-xs"><span className="h-1.5 w-1.5 rounded-full bg-violet-400" />{device.group?.name || t('unassigned')}</span></td>
      <td className="px-3 py-2"><StatusBadge value={device.status} />{device.agentUpdateAvailable && <span className="mt-1 block"><StatusBadge value="needs_update" label={t('agentUpdateAvailable')} /></span>}</td>
      <td className="px-3 py-2"><StatusBadge value={device.approvalStatus} /></td>
      <td className="px-3 py-2">
        <div className="flex min-w-[110px] flex-col items-start gap-0.5">
          {showAgentBadge(device) && <StatusBadge value={device.agentStatus} />}
          {device.agentUpdateStatus && (device.agentUpdateStatus === 'current'
            ? <StatusBadge value="current" />
            : <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${device.agentUpdateStatus === 'failed' ? 'text-rose-300' : 'text-orange-300'}`}>
              {device.agentUpdateStatus !== 'failed' && <Icon name="refresh" size={11} />}
            {t(device.agentUpdateStatus === 'failed' ? 'agentUpdateFailed'
              : device.agentUpdateStatus === 'queued' ? 'agentUpdateQueued'
                : device.agentUpdateStatus === 'downloading' ? 'agentUpdateDownloading'
                  : 'agentUpdateInstalling')}
          </span>)}
          {device.agentUpdateError && <span className="max-w-48 break-words text-[10px] text-rose-300">{device.agentUpdateError}</span>}
          {device.agentVersion && <span className="text-[10px] text-slate-500">v{device.agentVersion}</span>}
        </div>
      </td>
      <td className="px-3 py-2"><span className="inline-flex min-w-10 items-center justify-center rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-200">{device.disks.filter((disk) => disk.selectedForBackup).length}<span className="mx-1 text-slate-400">/</span>{device.disks.length}</span></td>
      <td className="px-3 py-2"><DeviceActions device={device} busy={busy} onUpdateAgent={onUpdateAgent} onApprove={() => onAction('approve')} onReject={() => onAction('reject')} onRevoke={() => onAction('revoke')} onDelete={() => onAction('delete')} /></td>
    </tr>;
}
