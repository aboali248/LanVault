import { Icon } from '../../components/Icon';

export function ScheduleSummary({ icon, title, value }: {
  icon: 'clock' | 'play' | 'stop';
  title: string;
  value: number;
}) {
  return <article className="surface flex items-center gap-3 p-4">
    <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-500/10 text-orange-300"><Icon name={icon} size={19} /></span>
    <div><p className="text-xs text-slate-400">{title}</p><p className="mt-0.5 text-xl font-bold">{value}</p></div>
  </article>;
}
