import { Icon } from './Icon';

export function Checkbox({ checked, onCheckedChange, disabled = false, ariaLabel, className = '' }: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
}) {
  return <span className={`relative inline-flex shrink-0 ${className}`}>
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onCheckedChange(event.target.checked)}
      className="peer sr-only"
    />
    <span
      aria-hidden
      className="grid h-5 w-5 cursor-pointer place-items-center rounded-[7px] border border-slate-300 bg-white shadow-sm transition-all duration-150 hover:border-orange-400 hover:shadow-md peer-checked:border-orange-500 peer-checked:bg-gradient-to-br peer-checked:from-orange-400 peer-checked:to-orange-600 peer-checked:shadow-orange-500/30 peer-checked:shadow-md peer-focus-visible:ring-4 peer-focus-visible:ring-orange-500/25 peer-disabled:cursor-not-allowed peer-disabled:opacity-40 peer-disabled:hover:border-slate-300 peer-disabled:hover:shadow-sm dark:border-slate-600 dark:bg-slate-900 dark:hover:border-orange-500/70 dark:peer-disabled:hover:border-slate-600"
    >
      <Icon name="check" size={14} className={`text-white transition-all duration-150 ${checked ? 'scale-100 opacity-100' : 'scale-50 opacity-0'}`} />
    </span>
  </span>;
}
