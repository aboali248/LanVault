import { useCallback, useEffect, useState } from 'react';
import { Icon } from '../../components/Icon';
import { Modal } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { useRealtime } from '../../hooks/useRealtime';
import { api } from '../../services/api';
import type { Device, Group, GroupInput, PaginationMeta, RealtimeEvent } from '../../types';
import { GroupDevices } from './GroupDevices';
import { GroupForm, type GroupFormValue } from './GroupForm';
import { GroupsList } from './GroupsList';

export function Groups() {
  const { t, language } = useApp();
  const ar = language === 'ar';
  const { notify } = useToast();
  const [groups, setGroups] = useState<Group[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [groupPage, setGroupPage] = useState(1);
  const [devicePage, setDevicePage] = useState(1);
  const [groupPagination, setGroupPagination] = useState<PaginationMeta>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [devicePagination, setDevicePagination] = useState<PaginationMeta>({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
  const [selected, setSelected] = useState<Group>();
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [editing, setEditing] = useState<Group | null | undefined>();
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeDeviceIds, setActiveDeviceIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [groupResult, deviceResult, queuedPage, runningPage, stoppingPage] = await Promise.all([
        api.listGroups({ page: groupPage, pageSize: 20 }), api.listDevices({ page: devicePage, pageSize: 20 }),
        api.listBackups({ page: 1, pageSize: 100, status: 'queued' }),
        api.listBackups({ page: 1, pageSize: 100, status: 'running' }),
        api.listBackups({ page: 1, pageSize: 100, status: 'cancel_requested' }),
      ]);
      setGroups(groupResult.items); setGroupPagination(groupResult.pagination);
      setDevices(deviceResult.items); setDevicePagination(deviceResult.pagination);
      setActiveDeviceIds(new Set([...queuedPage.items, ...runningPage.items, ...stoppingPage.items].map((backup) => backup.deviceId)));
      const params = new URLSearchParams(window.location.search);
      const linkedGroupId = params.get('groupId');
      const linkedDeviceId = params.get('deviceId');
      setSelected((current) => {
        const linked = linkedGroupId ? groupResult.items.find((group) => group.id === linkedGroupId) : undefined;
        const next = linked ?? groupResult.items.find((group) => group.id === current?.id) ?? current ?? groupResult.items[0];
        if (linkedDeviceId) setSelectedIds((ids) => (next?.deviceIds?.includes(linkedDeviceId) ? next.deviceIds : ids));
        else if (!current || linked) setSelectedIds(next?.deviceIds ?? []);
        return next;
      });
      if (linkedGroupId || linkedDeviceId) window.history.replaceState({}, '', '/groups');
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setLoading(false); }
  }, [groupPage, devicePage, notify, t]);
  useEffect(() => { void load(); }, [load]);

  // Live backup activity: patch only the affected device id from realtime
  // events so departments show "backing up" without a full reload.
  const applyBackupEvent = useCallback((event: RealtimeEvent) => {
    const payload = event.payload as { deviceId?: unknown; status?: unknown } | null;
    if (!payload || typeof payload !== 'object' || typeof payload.deviceId !== 'string' || typeof payload.status !== 'string') return;
    const { deviceId, status } = payload;
    setActiveDeviceIds((current) => {
      const next = new Set(current);
      if (['completed', 'failed', 'cancelled'].includes(status)) next.delete(deviceId);
      else next.add(deviceId);
      return next;
    });
  }, []);
  useRealtime(useCallback((event: RealtimeEvent) => {
    if (event.type === 'backup.progress' || event.type === 'backup.created') applyBackupEvent(event);
  }, [applyBackupEvent]));

  const saveGroup = async (value: GroupFormValue) => {
    const previousWindow = (editing ?? undefined)?.backupSettings?.backupWindow;
    const window = value.windowStart && value.windowEnd && value.days.length
      ? { start: value.windowStart, end: value.windowEnd, days: value.days, lastRunAt: previousWindow?.lastRunAt ?? null }
      : null;
    const input: GroupInput = {
      name: value.name,
      backupSettings: {
        ...(value.retentionCount ? { retentionCount: Number(value.retentionCount) } : {}),
        ...(value.maxTransferMbps ? { maxTransferMbps: Number(value.maxTransferMbps) } : {}),
        defaultBackupType: 'incremental',
        ...(window ? { backupWindow: window } : { backupWindow: null }),
      },
    };
    try {
      const group = editing ? await api.updateGroup(editing.id, input) : await api.createGroup(input);
      setEditing(undefined); setSelected(group); setSelectedIds(group.deviceIds ?? []); await load(); notify(t('actionSuccess'), 'success');
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
  };
  const selectMany = (ids: string[], checked: boolean) => {
    setSelectedIds((current) => checked
      ? [...new Set([...current, ...ids])]
      : current.filter((item) => !ids.includes(item)));
  };
  const deleteGroup = async (group: Group) => {
    if (!window.confirm(t('deleteGroupQuestion'))) return;
    try { await api.deleteGroup(group.id); if (selected?.id === group.id) setSelected(undefined); await load(); notify(t('actionSuccess'), 'success'); }
    catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
  };
  const saveDevices = async () => {
    if (!selected) return;
    setSaving(true);
    try { const group = await api.setGroupDevices(selected.id, selectedIds); setSelected(group); setSelectedIds(group.deviceIds ?? []); await load(); notify(t('actionSuccess'), 'success'); }
    catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setSaving(false); }
  };
  const runGroupBackups = async () => {
    if (!selected) return;
    try {
      const result = await api.queueGroupBackups(selected.id, selected.backupSettings?.defaultBackupType ?? 'incremental');
      const skipped = result.skipped.length;
      const detail = result.skipped.map((item) => `${devices.find((device) => device.id === item.deviceId)?.computerName ?? item.deviceId}: ${item.reason}`).join('\n');
      notify(`${result.queued.length} ${t('backupOperations')}${skipped ? ` · ${skipped} ${t('error')}\n${detail}` : ''}`, skipped ? 'error' : 'success');
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
  };
  const toggleGroupContinuous = async (group: Group, enabled: boolean) => {
    setSaving(true);
    try {
      const result = await api.setGroupDevicesContinuous(group.id, enabled);
      notify(ar ? `تم ${enabled ? 'تفعيل' : 'إيقاف'} المستمر لـ ${result.updated} جهاز` : `Continuous ${enabled ? 'enabled' : 'disabled'} for ${result.updated} device(s)`, 'success');
      await load();
    } catch (caught) { notify(caught instanceof Error ? caught.message : t('actionFailed'), 'error'); }
    finally { setSaving(false); }
  };
  const assignedDevices = groups.reduce((sum, group) => sum + (group.deviceCount ?? group.deviceIds?.length ?? 0), 0);
  const autoGroups = groups.filter((group) => group.backupSettings?.backupWindow).length;
  return <>
    <PageHeader icon="groups" title={t('groups')} description={t('groupManagement')} />
    <section className="mb-5 grid gap-3 sm:grid-cols-3" aria-label={t('groups')}>
      {[
        { label: t('groups'), value: groupPagination.total, icon: 'groups' as const, tone: 'text-orange-600 bg-orange-500/10' },
        { label: t('groupDevices'), value: assignedDevices, icon: 'desktop' as const, tone: 'text-sky-600 bg-sky-500/10' },
        { label: t('autoBackup'), value: autoGroups, icon: 'clock' as const, tone: 'text-emerald-600 bg-emerald-500/10' },
      ].map((item) => <article key={item.label} className="surface flex items-center gap-3 p-3.5">
        <span className={`grid h-10 w-10 place-items-center rounded-xl ${item.tone}`}><Icon name={item.icon} size={19} /></span>
        <div><p className="text-xs text-slate-500">{item.label}</p><p className="mt-0.5 text-lg font-bold text-slate-900 dark:text-white">{item.value}</p></div>
      </article>)}
    </section>
    <div className="grid items-start gap-5">
      <GroupsList groups={groups} selectedId={selected?.id} activeDeviceIds={activeDeviceIds} pagination={groupPagination} onPage={setGroupPage} onSelect={(group) => { setSelected(group); setSelectedIds(group.deviceIds ?? []); }} onCreate={() => setEditing(null)} onEdit={(group) => setEditing(group)} onDelete={(group) => void deleteGroup(group)} />
      {selected ? <GroupDevices group={selected} devices={devices} selectedIds={selectedIds} activeDeviceIds={activeDeviceIds} pagination={devicePagination} onPage={setDevicePage} onSelection={(id, checked) => setSelectedIds((current) => checked ? [...current.filter((value) => value !== id), id] : current.filter((item) => item !== id))} onSelectMany={(ids, checked) => selectMany(ids, checked)} onSave={() => void saveDevices()} onBackups={() => void runGroupBackups()} onEdit={() => setEditing(selected)} onToggleContinuous={(enabled) => void toggleGroupContinuous(selected, enabled)} saving={saving} />
        : <section className="surface grid min-h-72 place-items-center p-8 text-center text-sm text-slate-500">{loading ? t('loading') : t('noGroups')}</section>}
    </div>
    <Modal open={editing !== undefined} onClose={() => setEditing(undefined)} title={editing ? t('edit') : t('createGroup')}>
      <GroupForm key={editing?.id ?? 'new'} group={editing ?? undefined} onSave={(value) => void saveGroup(value)} onCancel={() => setEditing(undefined)} />
    </Modal>
  </>;
}
