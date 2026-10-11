import { Button } from '../../components/Button';
import { Icon } from '../../components/Icon';
import type { Group } from '../../types';
import { useApp } from '../../contexts/AppContext';
import { EmptyState } from '../../components/StateViews';
import { Pagination } from '../../components/Pagination';
import type { PaginationMeta } from '../../types';

const AVATARS = [
  'from-orange-500 to-amber-500',
  'from-sky-500 to-cyan-500',
  'from-emerald-500 to-teal-500',
  'from-violet-500 to-purple-500',
  'from-rose-500 to-pink-500',
  'from-indigo-500 to-blue-500',
];

function avatarTone(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return AVATARS[hash % AVATARS.length];
}

export function GroupsList({ groups, selectedId, activeDeviceIds, onSelect, onCreate, onEdit, onDelete, pagination, onPage }: {
  groups: Group[]; selectedId?: string; activeDeviceIds: Set<string>; onSelect: (group: Group) => void;
  onCreate: () => void; onEdit: (group: Group) => void; onDelete: (group: Group) => void;
  pagination: PaginationMeta; onPage: (page: number) => void;
}) {
  const { t } = useApp();
  return <section className="surface overflow-hidden">
    <header className="flex items-center justify-between gap-3 border-b border-slate-100 p-4 dark:border-slate-800">
      <div className="flex min-w-0 items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-orange-500/10 text-orange-600 dark:text-orange-300"><Icon name="groups" size={19} /></span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-bold text-slate-900 dark:text-white">{t('groups')}</h2>
          <p className="mt-0.5 text-[11px] text-slate-500"><span className="font-bold text-orange-600 dark:text-orange-300">{pagination.total}</span></p>
        </div>
      </div>
      <Button icon="plus" onClick={onCreate} className="shrink-0">{t('createGroup')}</Button>
    </header>
    {!groups.length
      ? <EmptyState icon="groups" title={t('noGroups')} action={<Button icon="plus" onClick={onCreate}>{t('createGroup')}</Button>} />
      : <div className="grid gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3 xl:grid-cols-4">{groups.map((group) => {
        const selected = selectedId === group.id;
        const count = group.deviceCount ?? group.deviceIds?.length ?? 0;
        const window = group.backupSettings?.backupWindow ?? null;
        const backingUpCount = (group.deviceIds ?? []).filter((id) => activeDeviceIds.has(id)).length;
        return <div key={group.id} className={`flex min-w-0 flex-col overflow-hidden rounded-2xl border transition ${selected
          ? 'border-orange-400 bg-orange-50/70 shadow-sm ring-2 ring-orange-500/20 dark:border-orange-700 dark:bg-orange-950/30 dark:ring-orange-500/20'
          : 'border-slate-200 bg-white hover:border-orange-300 hover:shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:hover:border-orange-800'}`}>
          <button type="button" onClick={() => onSelect(group)} aria-pressed={selected} className="block w-full p-3 text-start">
            <span className="flex items-center gap-2.5">
              <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-lg font-black text-white shadow-sm ${avatarTone(group.id)}`}>
                {group.name.trim().charAt(0).toUpperCase() || '؟'}
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-bold text-slate-900 dark:text-white">{group.name}</span>
                  {selected && <span className="h-2 w-2 shrink-0 rounded-full bg-orange-500" />}
                </span>
                {group.description && <span className="mt-0.5 block truncate text-[11px] text-slate-500">{group.description}</span>}
              </span>
            </span>
            <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                <Icon name="desktop" size={11} />{count} {t('devices')}
              </span>
              {backingUpCount > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />{t('backingUp')} · {backingUpCount}
              </span>}
              {window
                ? <span dir="ltr" className="inline-flex items-center gap-1 rounded-full bg-orange-500/10 px-2 py-0.5 text-[10px] font-bold text-orange-700 dark:text-orange-300">
                  <Icon name="clock" size={11} />{window.start}–{window.end}
                </span>
                : <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t('manualBackup')}</span>}
            </span>
          </button>
          <span className="mt-auto flex items-center gap-1 border-t border-slate-100 px-2 py-1.5 dark:border-slate-800">
            <Button variant="ghost" icon="edit" className="min-h-8 flex-1 px-2 text-[11px]" onClick={() => onEdit(group)}>{t('edit')}</Button>
            <Button variant="ghost" icon="trash" className="min-h-8 flex-1 px-2 text-[11px] text-rose-600" onClick={() => onDelete(group)}>{t('delete')}</Button>
          </span>
        </div>;
      })}</div>}
    <Pagination page={pagination.page} totalPages={pagination.totalPages} onPageChange={onPage} />
  </section>;
}
