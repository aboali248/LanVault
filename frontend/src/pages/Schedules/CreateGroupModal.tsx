import { useState } from 'react';
import { Button } from '../../components/Button';
import { Modal } from '../../components/Modal';

export interface QuickGroupValue {
  name: string;
  windowStart: string;
  windowEnd: string;
  days: number[];
}

export function CreateGroupModal({ open, onClose, onSubmit, saving, ar }: {
  open: boolean;
  onClose: () => void;
  onSubmit: (value: QuickGroupValue) => void;
  saving: boolean;
  ar: boolean;
}) {
  const dayNames = ar
    ? ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const [name, setName] = useState('');
  const [windowStart, setWindowStart] = useState('');
  const [windowEnd, setWindowEnd] = useState('');
  const [days, setDays] = useState<number[]>([]);
  const toggleDay = (day: number) => setDays((current) => current.includes(day)
    ? current.filter((item) => item !== day)
    : [...current, day].sort((a, b) => a - b));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    onSubmit({ name: name.trim(), windowStart, windowEnd, days });
  };
  return <Modal open={open} onClose={onClose} title={ar ? 'إضافة جروب جديد' : 'Add a new group'} size="md">
    <form className="space-y-4" onSubmit={submit}>
      <label className="label">{ar ? 'اسم الجروب' : 'Group name'}<input required maxLength={100} autoFocus className="input mt-1.5" value={name} onChange={(event) => setName(event.target.value)} placeholder={ar ? 'مثال: المحاسبة' : 'e.g. Finance'} /></label>
      <div className="rounded-2xl border border-orange-500/20 bg-orange-500/5 p-4">
        <p className="mb-3 text-xs font-bold">{ar ? 'موعد النسخ التلقائي (اختياري)' : 'Automatic backup window (optional)'}</p>
        <div className="grid grid-cols-2 gap-3">
          <label className="label">{ar ? 'من الساعة' : 'From'}<input type="time" dir="ltr" className="input mt-1.5" value={windowStart} onChange={(event) => setWindowStart(event.target.value)} /></label>
          <label className="label">{ar ? 'إلى الساعة' : 'To'}<input type="time" dir="ltr" className="input mt-1.5" value={windowEnd} onChange={(event) => setWindowEnd(event.target.value)} /></label>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {dayNames.map((day, index) => <button
            key={day}
            type="button"
            aria-pressed={days.includes(index)}
            onClick={() => toggleDay(index)}
            className={`min-h-8 rounded-lg border px-2.5 text-[11px] font-bold transition ${days.includes(index)
              ? 'border-orange-500 bg-orange-500/15 text-orange-200'
              : 'border-slate-700 text-slate-400 hover:border-slate-500'}`}
          >{day}</button>)}
        </div>
      </div>
      <p className="text-xs leading-5 text-slate-500">{ar ? 'بعد إنشاء الجروب سيُختار تلقائيًا لهذه الجدولة. النوع تزايدي دائمًا.' : 'The new group will be selected for this schedule. The backup type is always incremental.'}</p>
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>{ar ? 'إلغاء' : 'Cancel'}</Button><Button type="submit" icon="plus" loading={saving}>{ar ? 'إنشاء الجروب' : 'Create group'}</Button></div>
    </form>
  </Modal>;
}
