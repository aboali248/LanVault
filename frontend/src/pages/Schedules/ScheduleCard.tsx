import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import type { BackupSchedule } from '../../types';

type DayNames = string[];

export function ScheduleCard({ schedule, target, dayNames, language, ar, onEdit, onDuplicate, onDelete, onToggle }: {
  schedule: BackupSchedule;
  target?: string;
  dayNames: DayNames;
  language: string;
  ar: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return <article className="surface overflow-hidden">
    <div className="flex items-start justify-between gap-3 border-b border-slate-800/80 p-4 sm:p-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className={`mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl ${schedule.enabled ? 'bg-orange-500/15 text-orange-300' : 'bg-slate-800 text-slate-400'}`}><Icon name={schedule.targetType === 'group' ? 'groups' : 'desktop'} size={19} /></span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="truncate font-bold">{schedule.name}</h2><span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${schedule.enabled ? 'bg-orange-500/15 text-orange-300' : 'bg-slate-800 text-slate-400'}`}>{schedule.enabled ? (ar ? 'مفعّلة' : 'Enabled') : (ar ? 'متوقفة' : 'Paused')}</span></div>
          <p className="mt-1 truncate text-xs text-slate-400">{target ?? (ar ? 'الهدف غير موجود' : 'Target unavailable')} · {schedule.targetType === 'group' ? (ar ? 'جروب' : 'Group') : (ar ? 'جهاز' : 'Device')}</p>
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <IconButton label={ar ? 'تعديل الجدولة' : 'Edit schedule'} icon="edit" onClick={onEdit} />
        <IconButton label={ar ? 'نسخ الجدولة' : 'Duplicate schedule'} icon="history" onClick={onDuplicate} />
        <IconButton label={ar ? 'حذف الجدولة' : 'Delete schedule'} icon="trash" onClick={onDelete} danger />
      </div>
    </div>
    <div className="grid grid-cols-2 gap-2 p-4 sm:grid-cols-3 sm:p-5">
      <InfoTile icon="clock" label={ar ? 'الموعد' : 'Schedule'} value={schedule.repeatIntervalMinutes !== null
        ? `${schedule.windowStart}–${schedule.windowEnd} · ${ar ? `كل ${schedule.repeatIntervalMinutes} دقيقة` : `every ${schedule.repeatIntervalMinutes} min`}`
        : `${schedule.timeOfDay}${schedule.frequency === 'weekly' && schedule.dayOfWeek !== null ? ` · ${dayNames[schedule.dayOfWeek]}` : ` · ${ar ? 'يومي' : 'Daily'}`}`} />
      <InfoTile icon="backups" label={ar ? 'نوع النسخة' : 'Backup type'} value={schedule.mode === 'full' ? (ar ? 'كاملة' : 'Full') : (ar ? 'تزايدية' : 'Incremental')} />
      <InfoTile icon="database" label={ar ? 'الاحتفاظ' : 'Retention'} value={schedule.retentionCount ? `${schedule.retentionCount} ${ar ? 'نسخة' : 'copies'}` : (ar ? 'افتراضي' : 'Default')} />
      <InfoTile icon="history" label={ar ? 'آخر تشغيل مجدول' : 'Last scheduled run'} value={schedule.lastRunAt ? new Date(schedule.lastRunAt).toLocaleString('en-US') : (ar ? 'لم يعمل بعد' : 'Not run yet')} />
      <InfoTile icon="clock" label={ar ? 'التشغيل القادم' : 'Next run'} value={!schedule.enabled ? (ar ? 'متوقفة' : 'Paused') : schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString('en-US') : (ar ? 'غير معروف' : 'Unknown')} />
      <InfoTile icon="backups" label={ar ? 'نتيجة آخر نسخة' : 'Last backup result'} value={!schedule.lastRun ? (ar ? 'لا توجد نسخة بعد' : 'No backup yet') : `${schedule.lastRun.status} · ${new Date(schedule.lastRun.requestedAt).toLocaleDateString('en-US')}`} />
    </div>
    <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800/80 bg-slate-950/30 px-4 py-3 sm:px-5">
      <span className="text-[11px] text-slate-500">{ar ? 'الوقت حسب المنطقة الزمنية للخادم' : 'Time uses the server timezone'}</span>
      <Button variant={schedule.enabled ? 'outline' : 'primary'} icon={schedule.enabled ? 'stop' : 'play'} onClick={onToggle}>{schedule.enabled ? (ar ? 'إيقاف مؤقت' : 'Pause') : (ar ? 'تفعيل' : 'Enable')}</Button>
    </footer>
  </article>;
}

function InfoTile({ icon, label, value }: {
  icon: 'clock' | 'backups' | 'database' | 'history';
  label: string;
  value: string;
}) {
  return <div className="min-w-0 rounded-xl bg-slate-950/45 p-3">
    <p className="flex items-center gap-1.5 text-[10px] text-slate-500"><Icon name={icon} size={13} />{label}</p>
    <p className="mt-1 truncate text-xs font-semibold text-slate-200">{value}</p>
  </div>;
}

function IconButton({ label, icon, onClick, danger = false }: {
  label: string;
  icon: 'edit' | 'history' | 'trash';
  onClick: () => void;
  danger?: boolean;
}) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} className={`grid h-9 w-9 place-items-center rounded-lg transition ${danger ? 'text-slate-500 hover:bg-rose-500/10 hover:text-rose-300' : 'text-slate-400 hover:bg-slate-800 hover:text-orange-300'}`}>
    <Icon name={icon} size={16} />
  </button>;
}
