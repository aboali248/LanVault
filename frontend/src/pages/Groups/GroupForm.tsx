import { useState } from 'react';
import { Button } from '../../components/Button';
import type { Group } from '../../types';
import { useApp } from '../../contexts/AppContext';

export interface GroupFormValue {
  name: string;
  retentionCount: string;
  maxTransferMbps: string;
  windowStart: string;
  windowEnd: string;
  days: number[];
}

const dayNamesAr = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const dayNamesEn = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function GroupForm({ group, onSave, onCancel }: {
  group?: Group; onSave: (value: GroupFormValue) => void; onCancel: () => void;
}) {
  const { t, language } = useApp();
  const ar = language === 'ar';
  const dayNames = ar ? dayNamesAr : dayNamesEn;
  const [days, setDays] = useState<number[]>(group?.backupSettings?.backupWindow?.days ?? []);
  const toggleDay = (day: number) => setDays((current) => current.includes(day)
    ? current.filter((item) => item !== day)
    : [...current, day].sort((a, b) => a - b));
  return <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    onSave({
      name: String(data.get('name') ?? ''),
      retentionCount: String(data.get('retentionCount') ?? ''),
      maxTransferMbps: String(data.get('maxTransferMbps') ?? ''),
      windowStart: String(data.get('windowStart') ?? ''),
      windowEnd: String(data.get('windowEnd') ?? ''),
      days,
    });
  }}>
    <label className="label sm:col-span-2">{t('groupName')}<input name="name" required maxLength={100} defaultValue={group?.name ?? ''} className="input mt-1.5" /></label>
    <div className="sm:col-span-2"><h3 className="mb-3 text-sm font-bold">{t('groupBackupSettings')}</h3></div>
    <label className="label">{t('retention')}<input name="retentionCount" type="number" min="1" max="1000" defaultValue={group?.backupSettings?.retentionCount ?? ''} className="input mt-1.5" /></label>
    <label className="label">{t('maxSpeed')}<input name="maxTransferMbps" type="number" min="0.1" max="100000" step="0.1" defaultValue={group?.backupSettings?.maxTransferMbps ?? ''} className="input mt-1.5" /></label>
    <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4 sm:col-span-2">
      <p className="mb-1 text-sm font-bold">{ar ? 'موعد النسخ التلقائي للقسم' : 'Automatic backup window'}</p>
      <p className="mb-3 text-xs text-slate-500">{ar ? 'تُنسخ أجهزة القسم تلقائيًا (تزايدي) مرة كل يوم مختار داخل هذه النافذة. اترك الوقت فارغًا لإيقاف النسخ التلقائي.' : 'Department devices back up automatically (incremental) once per selected day inside this window. Leave the times empty to disable automatic backups.'}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="label">{ar ? 'من الساعة' : 'From'}<input name="windowStart" type="time" dir="ltr" defaultValue={group?.backupSettings?.backupWindow?.start ?? ''} className="input mt-1.5" /></label>
        <label className="label">{ar ? 'إلى الساعة' : 'To'}<input name="windowEnd" type="time" dir="ltr" defaultValue={group?.backupSettings?.backupWindow?.end ?? ''} className="input mt-1.5" /></label>
      </div>
      <div className="mt-3">
        <p className="mb-2 text-xs font-semibold text-slate-400">{ar ? 'الأيام' : 'Days'}</p>
        <div className="flex flex-wrap gap-2">
          {dayNames.map((day, index) => <button
            key={day}
            type="button"
            aria-pressed={days.includes(index)}
            onClick={() => toggleDay(index)}
            className={`min-h-9 rounded-xl border px-3 text-xs font-bold transition ${days.includes(index)
              ? 'border-orange-500 bg-orange-500/15 text-orange-200'
              : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
          >{day}</button>)}
        </div>
      </div>
    </div>
    <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={onCancel}>{t('cancel')}</Button><Button type="submit">{t('save')}</Button></div>
  </form>;
}
