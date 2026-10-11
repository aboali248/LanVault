import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { StatusBadge } from '../../components/StatusBadge';
import { Icon } from '../../components/Icon';
import { Select } from '../../components/Select';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import type { Device, Group, PaginationMeta } from '../../types';
import { navigate } from '../../components/AppShell';
import { DevicesTable } from './DevicesTable';
import { CreateGroupModal, type QuickGroupValue } from '../Schedules/CreateGroupModal';

const emptyPage: PaginationMeta = { page: 1, pageSize: 20, total: 0, totalPages: 0 };
export function Devices() {
  const { t, language } = useApp();
  const { notify } = useToast();
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [pagination, setPagination] = useState(emptyPage);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [approval, setApproval] = useState('');
  const [busyId, setBusyId] = useState<string>();
  const [savingId, setSavingId] = useState<string>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [approveTarget, setApproveTarget] = useState<Device | null>(null);
  const [approveGroupId, setApproveGroupId] = useState('');
  const [approving, setApproving] = useState(false);
  const [updatingAll, setUpdatingAll] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [form, setForm] = useState({ computerName: '', windowsUsername: '', ipAddress: '', macAddress: '', operatingSystem: '', groupId: '' });

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [result, groupResult] = await Promise.all([
        api.listDevices({ page, pageSize: 20, search, approval: approval || undefined }),
        api.listGroups(),
      ]);
      setDevices(result.items); setPagination(result.pagination); setGroups(groupResult.items);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t('actionFailed');
      setError(message); notify(message, 'error');
    } finally { setLoading(false); }
  }, [page, search, approval, notify, t]);
  useEffect(() => { void load(); }, [load]);

  const act = async (action: 'approve' | 'reject' | 'revoke' | 'delete', device: Device) => {
    if (action === 'delete' && !window.confirm(t('deleteDeviceQuestion'))) return;
    if (action === 'approve') {
      setApproveGroupId(device.group?.id ?? '');
      setApproveTarget(device);
      return;
    }
    setBusyId(device.id);
    try {
      if (action === 'reject') await api.rejectDevice(device.id);
      else if (action === 'revoke') await api.revokeDevice(device.id);
      else await api.deleteDevice(device.id);
      notify(t('actionSuccess'), 'success'); await load();
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setBusyId(undefined); }
  };
  const confirmApprove = async () => {
    if (!approveTarget) return;
    setApproving(true);
    setBusyId(approveTarget.id);
    try {
      const approvedDevice = await api.approveDevice(approveTarget.id);
      if (approveGroupId) await api.moveDeviceToGroup(approvedDevice.id, approveGroupId);
      notify(t('actionSuccess'), 'success');
      const target = approveTarget;
      const groupId = approveGroupId;
      setApproveTarget(null);
      await load();
      if (groupId) navigate(`/groups?groupId=${encodeURIComponent(groupId)}&deviceId=${encodeURIComponent(target.id)}`);
      else navigate(`/backups?deviceId=${encodeURIComponent(approvedDevice.id)}`);
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error');
    } finally {
      setApproving(false);
      setBusyId(undefined);
    }
  };
  const toggleDisk = async (device: Device, diskId: string, selected: boolean) => {
    setSavingId(device.id);
    try {
      const disks = device.disks.map((disk) => ({ id: disk.id, isSelected: disk.id === diskId ? selected : disk.selectedForBackup }));
      await api.updateDeviceDisks(device.id, disks);
      notify(t('actionSuccess'), 'success'); await load();
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setSavingId(undefined); }
  };
  const updateAgent = async (device: Device) => {
    setBusyId(device.id);
    try {
      const result = await api.updateDeviceAgent(device.id);
      setDevices((current) => current.map((item) => item.id === device.id
        ? { ...item, agentUpdateStatus: 'queued', agentUpdateError: null }
        : item));
      notify(result.alreadyQueued
        ? (language === 'ar'
          ? `تحديث Agent للجهاز ${device.computerName} في قائمة الانتظار وسيظهر تقدمه هنا.`
          : `The Agent update for ${device.computerName} is queued; progress will appear on this device.`)
        : (language === 'ar'
          ? `تم إرسال تحديث Agent للجهاز ${device.computerName} وسيظهر تقدمه هنا.`
          : `The Agent update was sent to ${device.computerName}; progress will appear on this device.`), 'success');
      await load();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error');
    } finally {
      setBusyId(undefined);
    }
  };
  const createGroupFromApprove = async (value: QuickGroupValue) => {
    if (!value.name) return;
    setCreatingGroup(true);
    try {
      const window = value.windowStart && value.windowEnd && value.days.length
        ? { start: value.windowStart, end: value.windowEnd, days: value.days, lastRunAt: null }
        : null;
      const group = await api.createGroup({
        name: value.name,
        backupSettings: {
          defaultBackupType: 'incremental',
          ...(window ? { backupWindow: window } : {}),
        },
      });
      setGroups((current) => [...current, group]);
      setApproveGroupId(group.id);
      setGroupModalOpen(false);
      notify(t('actionSuccess'), 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error');
    } finally {
      setCreatingGroup(false);
    }
  };
  const updateAllAgents = async () => {    setUpdatingAll(true);
    try {
      const result = await api.updateAllAgents();
      notify(language === 'ar'
        ? `تم إرسال تحديث Agent إلى ${result.queued.length} جهاز${result.skipped.length ? `، وتُخطي ${result.skipped.length} (غير متصل/محدّث/مشغول)` : ''}. تابع التقدم هنا.`
        : `Queued the Agent update for ${result.queued.length} device(s)${result.skipped.length ? `, skipped ${result.skipped.length} (offline/up-to-date/busy)` : ''}. Follow the progress here.`, 'success');
      await load();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error');
    } finally {
      setUpdatingAll(false);
    }
  };
  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const optional = (value: string) => value.trim() || undefined;
      await api.createDevice({
        computerName: form.computerName.trim(),
        windowsUsername: optional(form.windowsUsername),
        ipAddress: optional(form.ipAddress),
        macAddress: optional(form.macAddress),
        operatingSystem: optional(form.operatingSystem),
        groupId: form.groupId || null,
      });
      setAdding(false); setForm({ computerName: '', windowsUsername: '', ipAddress: '', macAddress: '', operatingSystem: '', groupId: '' });
      notify(t('deviceAdded'), 'success'); await load();
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
  };
  const discover = async () => {
    setDiscovering(true);
    try { const result = await api.discoverDevices(); notify(`${t('discoverDevices')}: ${result.discovered ?? result.devices?.length ?? 0}`, 'success'); await load(); }
    catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setDiscovering(false); }
  };
  const fields: Array<[keyof typeof form, string, boolean]> = [
    ['computerName', 'computerName', true], ['windowsUsername', 'username', false],
    ['ipAddress', 'ipAddress', false], ['macAddress', 'macAddress', false],
    ['operatingSystem', 'operatingSystem', false],
  ];
  const visibleOnlineCount = devices.filter((device) => device.status === 'online' || device.status === 'busy').length;
  const visiblePendingCount = devices.filter((device) => device.approvalStatus === 'pending').length;
  const visibleUpdateCount = devices.filter((device) => device.agentUpdateAvailable).length;
  return <>
    <PageHeader icon="devices" title={t('devices')} description={t('deviceManagement')} actions={<>
      <Button variant="outline" icon="wifi" onClick={() => void discover()} loading={discovering}>{t('discoverDevices')}</Button>
      <Button variant="outline" icon="refresh" onClick={() => void updateAllAgents()} loading={updatingAll}>{t('updateAllAgents')}</Button>
      <Button icon="plus" onClick={() => setAdding(true)}>{t('addDevice')}</Button>
    </>} />

    <section className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={t('deviceOverview')}>
      {[
        { label: t('devices'), value: devices.length, icon: 'devices' as const, tone: 'text-sky-300 bg-sky-500/10' },
        { label: t('online'), value: visibleOnlineCount, icon: 'wifi' as const, tone: 'text-emerald-300 bg-emerald-500/10' },
        { label: t('pending'), value: visiblePendingCount, icon: 'clock' as const, tone: 'text-amber-300 bg-amber-500/10' },
        { label: t('agentsNeedUpdate'), value: visibleUpdateCount, icon: 'refresh' as const, tone: 'text-orange-300 bg-orange-500/10' },
      ].map((item) => <article key={item.label} className="surface flex items-center gap-3 p-4">
        <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${item.tone}`}><Icon name={item.icon} size={20} /></span>
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{item.label}</p>
          <p className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{item.value}</p>
          <p className="text-[10px] text-slate-500">{t('currentPageSummary')}</p>
        </div>
      </article>)}
    </section>

    <details className="surface-muted group mb-5 overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-bold text-slate-800 marker:hidden dark:text-slate-100">
        <span className="flex items-center gap-2"><Icon name="info" size={17} className="text-orange-400" />{t('deviceGuide')}</span>
        <Icon name="chevronDown" size={17} className="text-slate-500 transition group-open:rotate-180" />
      </summary>
      <div className="grid gap-3 border-t border-slate-200/70 px-4 py-4 text-xs leading-6 text-slate-500 dark:border-slate-800 sm:grid-cols-3">
        <p><strong className="text-slate-800 dark:text-slate-200">{t('deviceGuideApprovalTitle')}</strong><br />{t('deviceGuideApproval')}</p>
        <p><strong className="text-slate-800 dark:text-slate-200">{t('deviceGuideBackupTitle')}</strong><br />{t('deviceGuideBackup')}</p>
        <p><strong className="text-slate-800 dark:text-slate-200">{t('deviceGuideUpdateTitle')}</strong><br />{t('deviceGuideUpdate')}</p>
      </div>
    </details>

    <section className="surface mb-4 p-3 sm:p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
        <label className="relative min-w-0 flex-1">
          <Icon name="search" size={17} className="pointer-events-none absolute start-3.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input ps-10" value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder={`${t('search')} · ${t('computerName')} / IP`} aria-label={t('search')} />
        </label>
        <Select className="lg:max-w-[240px]" value={approval} onValueChange={(value) => { setApproval(value); setPage(1); }} options={[
          { value: '', label: t('all') },
          { value: 'pending', label: t('pending') },
          { value: 'approved', label: t('approved') },
          { value: 'rejected', label: t('rejected') },
        ]} ariaLabel={language === 'ar' ? 'تصفية حسب الاعتماد' : 'Filter by approval'} />
        <Button variant="outline" icon="refresh" onClick={() => void load()} loading={loading}>{t('refresh')}</Button>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-slate-100 pt-3 text-xs text-slate-500 dark:border-slate-800">
        <span>{t('showingDevices')
        .replace('{from}', String(pagination.total ? (page - 1) * pagination.pageSize + 1 : 0))
        .replace('{to}', String(Math.min(page * pagination.pageSize, pagination.total)))
        .replace('{total}', String(pagination.total))}</span>
        {visibleUpdateCount > 0 && <StatusBadge value="needs_update" label={`${visibleUpdateCount} ${t('agentsNeedUpdate')}`} />}
        {devices.some((device) => ['queued', 'downloading', 'installing'].includes(device.agentUpdateStatus ?? '')) && <span className="inline-flex items-center gap-1.5 font-semibold text-orange-300">
          <span className="h-2 w-2 animate-pulse rounded-full bg-orange-400" />{t('agentUpdatesInProgress')}
        </span>}
      </div>
    </section>
    {error && <div role="alert" className="mb-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950/30 dark:text-rose-300">{error} <Button variant="ghost" onClick={() => void load()}>{t('retry')}</Button></div>}
    {loading && <div className="surface mb-3 animate-pulse p-4 text-sm text-slate-500">{t('loading')}</div>}
    <DevicesTable devices={devices} pagination={pagination} busyId={busyId} savingId={savingId} onPage={setPage} onAction={(action, device) => void act(action, device)} onUpdateAgent={(device) => void updateAgent(device)} onToggleDisk={(device, id, selected) => void toggleDisk(device, id, selected)} />
    <Modal open={adding} onClose={() => setAdding(false)} title={t('addDevice')}>
      <form onSubmit={(event) => void create(event)} className="grid gap-4 sm:grid-cols-2">
        {fields.map(([key, label, required]) => <label key={key} className="label">{t(label as never)}<input required={required} className="input mt-1.5" value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} /></label>)}
        <label className="label">{t('department')}<Select className="mt-1.5" value={form.groupId} onValueChange={(groupId) => setForm({ ...form, groupId })} searchable options={[{ value: '', label: t('unassigned') }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} /></label>
        <p className="text-xs text-slate-500 sm:col-span-2">{language === 'ar' ? 'سيضاف الجهاز بحالة انتظار الاعتماد، دون اعتماد أي قرص تلقائيًا.' : 'The device is added pending approval; no disks are selected automatically.'}</p>
        <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="outline" type="button" onClick={() => setAdding(false)}>{t('cancel')}</Button><Button type="submit">{t('add')}</Button></div>
      </form>
    </Modal>
    <Modal open={approveTarget !== null} onClose={() => setApproveTarget(null)} title={`${t('approve')} · ${approveTarget?.computerName ?? ''}`}>
      <p className="mb-4 text-sm text-slate-500">{t('approveDeviceHint')}</p>
      <div className="label">{t('department')}
        <div className="mt-1.5 flex gap-2">
          <Select
            className="flex-1"
            value={approveGroupId}
            onValueChange={setApproveGroupId}
            searchable
            options={[{ value: '', label: t('unassigned') }, ...groups.map((group) => ({ value: group.id, label: group.name, description: `${group.deviceCount ?? 0} ${t('devices')}` }))]}
            ariaLabel={t('department')}
          />
          <Button type="button" variant="outline" icon="plus" aria-label={t('createGroup')} title={t('createGroup')} onClick={() => setGroupModalOpen(true)} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-500 dark:bg-slate-950/50">
        <span>{t('approveGroupLinkHint')}</span>
        <Button variant="ghost" className="min-h-8 px-2.5 text-xs" icon="groups" type="button" onClick={() => { setApproveTarget(null); navigate('/groups'); }}>{t('groups')}</Button>
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" type="button" disabled={approving} onClick={() => setApproveTarget(null)}>{t('cancel')}</Button>
        <Button type="button" icon="check" loading={approving} onClick={() => void confirmApprove()}>{t('approve')}</Button>
      </div>
    </Modal>
    <CreateGroupModal
      open={groupModalOpen}
      onClose={() => setGroupModalOpen(false)}
      onSubmit={(value) => void createGroupFromApprove(value)}
      saving={creatingGroup}
      ar={language === 'ar'}
    />
  </>;
}
