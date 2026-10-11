import type { ButtonHTMLAttributes } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'outline';
interface Props extends ButtonHTMLAttributes<HTMLButtonElement> { variant?: Variant; icon?: IconName; loading?: boolean; }

export function Button({ children, variant = 'primary', icon, loading, className = '', disabled, ...props }: Props) {
  const variants: Record<Variant, string> = {
    primary: 'bg-orange-500 text-slate-950 hover:bg-orange-400 dark:bg-orange-500 dark:text-slate-950 dark:hover:bg-orange-400',
    secondary: 'bg-orange-600 text-white hover:bg-orange-500',
    danger: 'bg-rose-600 text-white hover:bg-rose-500',
    ghost: 'bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
    outline: 'border border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800',
  };
  return <button {...props} disabled={disabled || loading} className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition focus:outline-none focus:ring-4 focus:ring-orange-500/20 disabled:cursor-not-allowed disabled:opacity-55 ${variants[variant]} ${className}`}>
    {loading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : icon && <Icon name={icon} size={17} />}
    {children}
  </button>;
}
