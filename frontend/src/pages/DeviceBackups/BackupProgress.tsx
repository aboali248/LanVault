import type { Backup } from '../../types';
import { formatBytes, formatDate } from '../../utils/format';
import { useApp } from '../../contexts/AppContext';

export function BackupProgress({ backup }: { backup: Backup }) {
  const { language } = useApp();
  const percent = Math.max(0, Math.min(100, backup.progressPercent ?? 0));
  return <div className="min-w-0">
    <div className="mb-1 flex justify-between text-[11px]"><span className="font-bold tabular-nums">{percent.toFixed(0)}%</span><bdi dir="ltr" className="text-slate-500">{formatBytes(backup.bytesProcessed, language)}{backup.totalBytes != null ? ` / ${formatBytes(backup.totalBytes, language)}` : ''}</bdi></div>
    <div className="h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-600 transition-[width]" style={{ width: `${percent}%` }} /></div>
    <p className="mt-1 text-[10px] text-slate-500">{formatDate(backup.startedAt ?? backup.createdAt, language)}</p>
  </div>;
}
