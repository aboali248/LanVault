import { Icon } from './Icon';

export function PageHeader({ icon, title, description, actions }: { icon: Parameters<typeof Icon>[0]['name']; title: string; description: string; actions?: React.ReactNode }) {
  return <header className="mb-7 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
    <div className="flex items-start gap-3">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-orange-400 to-orange-600 text-white shadow-lg shadow-orange-600/20"><Icon name={icon} size={21} /></span>
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">{title}</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>
      </div>
    </div>
    {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
  </header>;
}
