import { Button } from '../../components/Button';
import { Checkbox } from '../../components/Checkbox';
import { Modal } from '../../components/Modal';
import { Select } from '../../components/Select';
import type { Device, Group } from '../../types';
import type { ScheduleForm } from './scheduleTypes';

export function ScheduleFormModal({ open, onClose, onSubmit, form, setForm, editing, saving, devices, groups, onAddGroup, ar }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (event: React.FormEvent) => void;
  form: ScheduleForm;
  setForm: (form: ScheduleForm) => void;
  editing: boolean;
  saving: boolean;
  devices: Device[];
  groups: Group[];
  onAddGroup: () => void;
  ar: boolean;
}) {
  const dayNames = ar
    ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const targetOptions = form.targetType === 'device'
    ? devices.map((device) => ({ value: device.id, label: device.computerName }))
    : groups.map((group) => ({ value: group.id, label: group.name }));

  return <Modal open={open} onClose={onClose} title={editing ? (ar ? 'تعديل الجدولة' : 'Edit schedule') : (ar ? 'إضافة جدولة جديدة' : 'Create a schedule')} size="lg">
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-orange-300">{ar ? '١. تعريف الجدولة' : '1. Schedule details'}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="label sm:col-span-2">{ar ? 'اسم واضح للجدولة' : 'Schedule name'}<input required maxLength={120} autoFocus className="input mt-1.5" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder={ar ? 'مثال: نسخ أجهزة المحاسبة يوميًا' : 'e.g. Daily finance backup'} /></label>
          <label className="label">{ar ? 'تطبيق الجدولة على' : 'Apply schedule to'}<Select className="mt-1.5" value={form.targetType} onValueChange={(value) => {
            const targetType = value as ScheduleForm['targetType'];
            const firstTarget = targetType === 'device' ? devices[0]?.id : groups[0]?.id;
            setForm({ ...form, targetType, targetId: firstTarget ?? '' });
          }} options={[{ value: 'device', label: ar ? 'جهاز' : 'Device' }, { value: 'group', label: ar ? 'جروب كامل' : 'Entire group' }]} /></label>
          <div className="label">{form.targetType === 'device' ? (ar ? 'الجهاز' : 'Device') : (ar ? 'الجروب' : 'Group')}<div className="mt-1.5 flex gap-2">
            <Select className="flex-1" value={form.targetId} onValueChange={(targetId) => setForm({ ...form, targetId })} searchable options={targetOptions} placeholder={ar ? 'اختر' : 'Select'} />
            {form.targetType === 'group' && <Button type="button" variant="outline" icon="plus" aria-label={ar ? 'إضافة جروب جديد' : 'Add a group'} title={ar ? 'إضافة جروب' : 'Add group'} onClick={onAddGroup} />}
          </div></div>
        </div>
        {form.targetType === 'group' && groups.length === 0 && <p className="mt-2 text-xs text-amber-300">{ar ? 'لا توجد جروبات بعد. اضغط + لإنشاء أول جروب.' : 'No groups yet. Use + to create your first group.'}</p>}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-orange-300">{ar ? '٢. التكرار والموعد' : '2. Timing and recurrence'}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="label">{ar ? 'التكرار' : 'Frequency'}<Select className="mt-1.5" value={form.frequency} onValueChange={(frequency) => setForm({ ...form, frequency: frequency as ScheduleForm['frequency'], dayOfWeek: null })} options={[{ value: 'daily', label: ar ? 'كل يوم' : 'Every day' }, { value: 'weekly', label: ar ? 'كل أسبوع' : 'Every week' }]} /></label>
          {form.frequency === 'weekly' && <label className="label">{ar ? 'يوم التنفيذ' : 'Run on'}<Select className="mt-1.5" value={form.dayOfWeek === null ? '' : String(form.dayOfWeek)} onValueChange={(dayOfWeek) => setForm({ ...form, dayOfWeek: Number(dayOfWeek) })} options={dayNames.map((day, index) => ({ value: String(index), label: day }))} placeholder={ar ? 'اختر اليوم' : 'Choose a day'} /></label>}
          <label className="label">{ar ? 'وقت البدء' : 'Start time'}<input required type="time" className="input mt-1.5" value={form.timeOfDay} onChange={(event) => setForm({ ...form, timeOfDay: event.target.value })} /><span className="mt-1 block text-[11px] font-normal text-slate-500">{ar ? 'وفق توقيت الخادم المحلي — تعمل الجدولة تلقائيًا عند تفعيلها، وتظهر حالة التشغيل القادم في بطاقة الجدولة.' : 'Uses the server local time — an enabled schedule runs automatically; watch its next-run status on the schedule card.'}</span></label>
        </div>
        <label className="mt-4 flex cursor-pointer items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm">
          <Checkbox
            checked={form.repeatIntervalMinutes !== null}
            onCheckedChange={(checked) => setForm(checked
              ? { ...form, windowStart: form.windowStart ?? '08:00', windowEnd: form.windowEnd ?? '18:00', repeatIntervalMinutes: form.repeatIntervalMinutes ?? 60 }
              : { ...form, windowStart: null, windowEnd: null, repeatIntervalMinutes: null })}
          />
          <span><span className="block font-semibold">{ar ? 'تكرار النسخ داخل نافذة زمنية' : 'Repeat backups inside a time window'}</span><span className="text-xs text-slate-500">{ar ? 'مثال: كل 60 دقيقة من 08:00 إلى 18:00 للجهاز أو الجروب المختار.' : 'e.g. every 60 minutes from 08:00 to 18:00 for the selected device or group.'}</span></span>
        </label>
        {form.repeatIntervalMinutes !== null && <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className="label">{ar ? 'من الساعة' : 'Window start'}<input required type="time" className="input mt-1.5" value={form.windowStart ?? ''} onChange={(event) => setForm({ ...form, windowStart: event.target.value || null })} /></label>
          <label className="label">{ar ? 'إلى الساعة' : 'Window end'}<input required type="time" className="input mt-1.5" value={form.windowEnd ?? ''} onChange={(event) => setForm({ ...form, windowEnd: event.target.value || null })} /></label>
          <label className="label">{ar ? 'كل (دقيقة)' : 'Every (minutes)'}<input required type="number" min={5} max={1440} className="input mt-1.5" value={form.repeatIntervalMinutes ?? ''} onChange={(event) => setForm({ ...form, repeatIntervalMinutes: event.target.value ? Number(event.target.value) : null })} /></label>
        </div>}
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/30 p-4">
        <p className="mb-3 text-xs font-bold uppercase tracking-wide text-orange-300">{ar ? '٣. سياسة النسخ' : '3. Backup policy'}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="label">{ar ? 'طريقة النسخ' : 'Backup mode'}<Select className="mt-1.5" value={form.mode} onValueChange={(mode) => setForm({ ...form, mode: mode as ScheduleForm['mode'] })} options={[{ value: 'incremental', label: ar ? 'تزايدي — الملفات التي تغيرت' : 'Incremental — changed files' }, { value: 'full', label: ar ? 'كامل — جميع الملفات المختارة' : 'Full — all selected files' }]} /></label>
          <label className="label">{ar ? 'عدد النسخ للاحتفاظ' : 'Copies to retain'}<input type="number" min={1} max={1000} className="input mt-1.5" value={form.retentionCount ?? ''} onChange={(event) => setForm({ ...form, retentionCount: event.target.value ? Number(event.target.value) : null })} placeholder={ar ? 'استخدم إعدادات النظام' : 'Use system default'} /><span className="mt-1 block text-[11px] font-normal text-slate-500">{ar ? 'اتركه فارغًا لاستخدام سياسة الاحتفاظ الافتراضية.' : 'Leave blank to use the default retention policy.'}</span></label>
        </div>
      </div>
      <label className="flex items-center gap-3 rounded-xl border border-slate-800 p-3 text-sm"><Checkbox checked={form.enabled} onCheckedChange={(checked) => setForm({ ...form, enabled: checked })} /><span><span className="block font-semibold">{ar ? 'تفعيل الجدولة فور الحفظ' : 'Enable schedule immediately'}</span><span className="text-xs text-slate-500">{ar ? 'يمكنك إيقافها أو تفعيلها لاحقًا دون حذفها.' : 'You can pause or resume it later without deleting it.'}</span></span></label>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button type="submit" icon={editing ? 'save' : 'plus'} loading={saving} disabled={!form.targetId}>{editing ? (ar ? 'حفظ التعديلات' : 'Save changes') : (ar ? 'إنشاء الجدولة' : 'Create schedule')}</Button></div>
    </form>
  </Modal>;
}
