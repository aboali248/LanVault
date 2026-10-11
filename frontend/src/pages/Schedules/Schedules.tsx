import { useCallback, useEffect, useMemo, useState } from 'react';
import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { useApp } from '../../contexts/AppContext';
import { useToast } from '../../contexts/ToastContext';
import { api } from '../../services/api';
import type { BackupSchedule, Device, Group } from '../../types';
import { CreateGroupModal, type QuickGroupValue } from './CreateGroupModal';
import { ScheduleCard } from './ScheduleCard';
import { ScheduleFormModal } from './ScheduleFormModal';
import { ScheduleSummary } from './ScheduleSummary';
import { ScheduleToolbar } from './ScheduleToolbar';
import { blankForm, type ScheduleForm } from './scheduleTypes';

export function Schedules() {
  const { language } = useApp();
  const { notify } = useToast();
  const ar = language === 'ar';
  const [schedules, setSchedules] = useState<BackupSchedule[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState<ScheduleForm>(blankForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState(false);
  const [savingGroup, setSavingGroup] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'enabled' | 'paused'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [scheduleRows, deviceRows, groupRows] = await Promise.all([
        api.listSchedules(),
        api.listDevices({ page: 1, pageSize: 100, approval: 'approved' }),
        api.listGroups({ page: 1, pageSize: 100 }),
      ]);
      setSchedules(scheduleRows);
      setDevices(deviceRows.items);
      setGroups(groupRows.items);
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : (ar ? 'تعذر تحميل الجدولات' : 'Could not load schedules');
      setError(message);
      notify(message, 'error');
    } finally {
      setLoading(false);
    }
  }, [ar, notify]);
  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => schedules.filter((item) => {
    const target = item.targetType === 'device'
      ? devices.find((device) => device.id === item.targetId)?.computerName
      : groups.find((group) => group.id === item.targetId)?.name;
    const matchesQuery = `${item.name} ${target ?? ''}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase());
    return matchesQuery && (filter === 'all' || (filter === 'enabled' ? item.enabled : !item.enabled));
  }), [schedules, devices, groups, query, filter]);
  const enabledCount = schedules.filter((item) => item.enabled).length;
  const dayNames = ar
    ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...blankForm, targetId: devices[0]?.id ?? '' });
    setFormOpen(true);
  };
  const openEdit = (schedule: BackupSchedule) => {
    setEditingId(schedule.id);
    setForm({
      name: schedule.name,
      targetType: schedule.targetType,
      targetId: schedule.targetId,
      frequency: schedule.frequency,
      dayOfWeek: schedule.dayOfWeek,
      timeOfDay: schedule.timeOfDay,
      mode: schedule.mode,
      retentionCount: schedule.retentionCount,
      enabled: schedule.enabled,
      windowStart: schedule.windowStart,
      windowEnd: schedule.windowEnd,
      repeatIntervalMinutes: schedule.repeatIntervalMinutes,
    });
    setFormOpen(true);
  };
  const duplicateSchedule = (schedule: BackupSchedule) => {
    setEditingId(null);
    setForm({
      name: `${schedule.name} (${ar ? 'نسخة' : 'copy'})`,
      targetType: schedule.targetType,
      targetId: schedule.targetId,
      frequency: schedule.frequency,
      dayOfWeek: schedule.dayOfWeek,
      timeOfDay: schedule.timeOfDay,
      mode: schedule.mode,
      retentionCount: schedule.retentionCount,
      enabled: true,
      windowStart: schedule.windowStart,
      windowEnd: schedule.windowEnd,
      repeatIntervalMinutes: schedule.repeatIntervalMinutes,
    });
    setFormOpen(true);
  };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = { ...form, dayOfWeek: form.frequency === 'weekly' ? form.dayOfWeek : null };
      if (editingId) await api.updateSchedule(editingId, payload);
      else await api.createSchedule(payload);
      setFormOpen(false);
      notify(ar ? (editingId ? 'تم تحديث الجدولة' : 'تمت إضافة الجدولة') : (editingId ? 'Schedule updated' : 'Schedule created'), 'success');
      await load();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : (ar ? 'تعذر حفظ الجدولة' : 'Could not save schedule'), 'error');
    } finally {
      setSaving(false);
    }
  };
  const updateSchedule = async (schedule: BackupSchedule, changes: Partial<ScheduleForm>) => {
    const { id, lastRunAt: _lastRunAt, nextRunAt: _nextRunAt, lastRun: _lastRun, createdAt: _createdAt, updatedAt: _updatedAt, ...current } = schedule;
    try {
      await api.updateSchedule(id, { ...current, ...changes });
      await load();
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : (ar ? 'تعذر تحديث الجدولة' : 'Could not update schedule'), 'error');
    }
  };
  const deleteSchedule = async (schedule: BackupSchedule) => {
    if (!window.confirm(ar ? `حذف الجدولة «${schedule.name}»؟` : `Delete schedule "${schedule.name}"?`)) return;
    try {
      await api.deleteSchedule(schedule.id);
      await load();
      notify(ar ? 'تم حذف الجدولة' : 'Schedule deleted', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : (ar ? 'تعذر حذف الجدولة' : 'Could not delete schedule'), 'error');
    }
  };
  const createGroup = async (value: QuickGroupValue) => {
    if (!value.name) return;
    setSavingGroup(true);
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
      setForm((current) => ({ ...current, targetType: 'group', targetId: group.id }));
      setGroupOpen(false);
      notify(ar ? 'تم إنشاء الجروب واختياره للجدولة' : 'Group created and selected', 'success');
    } catch (caught) {
      notify(caught instanceof Error ? caught.message : (ar ? 'تعذر إنشاء الجروب' : 'Could not create group'), 'error');
    } finally {
      setSavingGroup(false);
    }
  };

  const targetName = (schedule: BackupSchedule) => schedule.targetType === 'device'
    ? devices.find((device) => device.id === schedule.targetId)?.computerName
    : groups.find((group) => group.id === schedule.targetId)?.name;

  return <>
    <PageHeader icon="clock" title={ar ? 'جدولة النسخ' : 'Backup schedules'} description={ar ? 'أنشئ خطط نسخ تلقائية للأجهزة أو الجروبات، وتابع حالتها بسهولة.' : 'Create automatic backup plans for devices or groups and manage them in one place.'}
      actions={<><Button variant="outline" icon="refresh" onClick={() => void load()} loading={loading}>{ar ? 'تحديث' : 'Refresh'}</Button><Button icon="plus" onClick={openCreate}>{ar ? 'إضافة جدولة' : 'Add schedule'}</Button></>} />

    <div className="mb-5 grid gap-3 sm:grid-cols-3">
      <ScheduleSummary icon="clock" title={ar ? 'إجمالي الجداول' : 'Total schedules'} value={schedules.length} />
      <ScheduleSummary icon="play" title={ar ? 'جداول مفعّلة' : 'Enabled'} value={enabledCount} />
      <ScheduleSummary icon="stop" title={ar ? 'جداول متوقفة' : 'Paused'} value={schedules.length - enabledCount} />
    </div>
    <ScheduleToolbar query={query} onQueryChange={setQuery} filter={filter} onFilterChange={setFilter} ar={ar} />
    {error && <div role="alert" className="surface mb-4 p-4 text-sm text-rose-300">{error}</div>}

    {loading && schedules.length === 0
      ? <section className="surface p-10 text-center text-sm text-slate-400">{ar ? 'جارٍ تحميل الجداول…' : 'Loading schedules…'}</section>
      : filtered.length === 0
        ? <section className="surface grid justify-items-center px-6 py-14 text-center">
          <span className="mb-4 grid h-14 w-14 place-items-center rounded-2xl bg-orange-500/10 text-orange-300"><Icon name={query || filter !== 'all' ? 'search' : 'clock'} size={26} /></span>
          <h2 className="text-lg font-bold">{query || filter !== 'all' ? (ar ? 'لا توجد نتائج مطابقة' : 'No matching schedules') : (ar ? 'ابدأ بأول جدولة تلقائية' : 'Create your first schedule')}</h2>
          <p className="mt-2 max-w-lg text-sm text-slate-400">{ar ? 'حدد الجهاز أو الجروب، موعد النسخ، ونوع النسخة وسيعمل الخادم تلقائيًا.' : 'Choose a device or group, schedule, and backup type. The server will run it automatically.'}</p>
          {!query && filter === 'all' && <Button className="mt-5" icon="plus" onClick={openCreate}>{ar ? 'إنشاء جدولة' : 'Create schedule'}</Button>}
        </section>
        : <section className="grid gap-4 xl:grid-cols-2">
          {filtered.map((schedule) => <ScheduleCard
            key={schedule.id}
            schedule={schedule}
            target={targetName(schedule)}
            dayNames={dayNames}
            language={language}
            ar={ar}
            onEdit={() => openEdit(schedule)}
            onDuplicate={() => duplicateSchedule(schedule)}
            onDelete={() => void deleteSchedule(schedule)}
            onToggle={() => void updateSchedule(schedule, { enabled: !schedule.enabled })}
          />)}
        </section>}

    <p className="mt-4 text-xs leading-5 text-slate-500">{ar ? 'لتنفيذ النسخ يجب أن يكون الجهاز معتمدًا ومتصلًا، وأن يحتوي على قرص واحد مختار على الأقل. عند اختيار جروب، تُتخطى الأجهزة غير الجاهزة.' : 'Devices must be approved, connected, and have at least one selected disk. Group schedules skip devices that are not ready.'}</p>
    <ScheduleFormModal open={formOpen} onClose={() => setFormOpen(false)} onSubmit={(event) => void submit(event)} form={form} setForm={setForm} editing={Boolean(editingId)} saving={saving} devices={devices} groups={groups} onAddGroup={() => setGroupOpen(true)} ar={ar} />
    <CreateGroupModal open={groupOpen} onClose={() => setGroupOpen(false)} onSubmit={(value) => void createGroup(value)} saving={savingGroup} ar={ar} />
  </>;
}
