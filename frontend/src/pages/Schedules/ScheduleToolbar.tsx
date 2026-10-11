import { Icon } from '../../components/Icon';

export function ScheduleToolbar({ query, onQueryChange, filter, onFilterChange, ar }: {
  query: string;
  onQueryChange: (query: string) => void;
  filter: 'all' | 'enabled' | 'paused';
  onFilterChange: (filter: 'all' | 'enabled' | 'paused') => void;
  ar: boolean;
}) {
  return <section className="surface mb-5 p-4 sm:p-5">
    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
      <label className="relative min-w-0 flex-1">
        <Icon name="search" size={18} className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-slate-500 ${ar ? 'right-3' : 'left-3'}`} />
        <input className={`input ${ar ? 'pr-10' : 'pl-10'}`} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={ar ? 'ابحث باسم الجدولة أو الجهاز أو الجروب' : 'Search by schedule, device, or group'} />
      </label>
      <div className="flex rounded-xl border border-slate-800 bg-slate-950 p-1" role="group" aria-label={ar ? 'تصفية الجداول' : 'Filter schedules'}>
        {(['all', 'enabled', 'paused'] as const).map((item) => <button key={item} type="button" onClick={() => onFilterChange(item)} className={`rounded-lg px-3 py-2 text-xs font-semibold transition ${filter === item ? 'bg-orange-500 text-slate-950' : 'text-slate-400 hover:text-white'}`}>
          {item === 'all' ? (ar ? 'الكل' : 'All') : item === 'enabled' ? (ar ? 'مفعّلة' : 'Enabled') : (ar ? 'متوقفة' : 'Paused')}
        </button>)}
      </div>
    </div>
  </section>;
}
