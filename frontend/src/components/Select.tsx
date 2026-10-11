import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useApp } from '../contexts/AppContext';

export interface SelectOption {
  value: string;
  label: string;
  description?: string;
}

export function Select({ options, value, onValueChange, className = '', placeholder, searchable = false, disabled = false, name, id, ariaLabel }: {
  options: SelectOption[];
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  searchable?: boolean;
  disabled?: boolean;
  name?: string;
  id?: string;
  ariaLabel?: string;
}) {
  const { language } = useApp();
  const ar = language === 'ar';
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = options.find((option) => option.value === value);
  const filteredOptions = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return term ? options.filter((option) => `${option.label} ${option.description ?? ''}`.toLocaleLowerCase().includes(term)) : options;
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    if (searchable) searchRef.current?.focus();
    return () => document.removeEventListener('pointerdown', closeOnOutside);
  }, [open, searchable]);

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const choose = (option: SelectOption) => {
    onValueChange(option.value);
    setOpen(false);
    setQuery('');
  };
  const toggle = () => {
    if (disabled) return;
    setQuery('');
    setActiveIndex(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen((current) => !current);
  };
  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) toggle();
      else setActiveIndex((current) => event.key === 'ArrowDown'
        ? Math.min(filteredOptions.length - 1, current + 1)
        : Math.max(0, current - 1));
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (!open) { event.preventDefault(); toggle(); }
      else if (filteredOptions[activeIndex]) { event.preventDefault(); choose(filteredOptions[activeIndex]); }
    } else if (event.key === 'Escape' && open) {
      event.preventDefault();
      setOpen(false);
    }
  };

  return <div ref={rootRef} className="relative min-w-0">
    {name && <input type="hidden" name={name} value={value} />}
    <button
      id={id}
      type="button"
      disabled={disabled}
      aria-label={ariaLabel}
      aria-haspopup="listbox"
      aria-expanded={open}
      onClick={toggle}
      onKeyDown={onTriggerKeyDown}
      className={`input flex min-h-[46px] items-center justify-between gap-3 text-start transition-all duration-150 hover:border-orange-500/40 hover:shadow-lg hover:shadow-orange-500/5 ${open ? 'border-orange-500 shadow-lg shadow-orange-500/10 ring-4 ring-orange-500/15' : ''} ${disabled ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'} ${className}`}
    >
      <span className={`min-w-0 flex-1 truncate ${selected ? 'font-semibold text-slate-100' : 'text-slate-500'}`}>{selected?.label ?? placeholder ?? (ar ? 'اختر خيارًا' : 'Choose an option')}</span>
      <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg transition-all duration-200 ${open ? 'rotate-180 bg-orange-500 text-[#1a1005] shadow shadow-orange-500/40' : 'bg-orange-500/10 text-orange-300'}`}>
        <Icon name="chevronDown" size={16} />
      </span>
    </button>
    {open && <div
      dir={ar ? 'rtl' : 'ltr'}
      className={`absolute top-[calc(100%+0.5rem)] z-[60] w-[max(100%,240px)] max-w-[calc(100vw-24px)] overflow-hidden rounded-2xl border border-white/10 bg-[#141416]/95 p-2 shadow-2xl shadow-black/60 ring-1 ring-white/10 backdrop-blur-xl animate-fade-up ${ar ? 'right-0' : 'left-0'}`}
    >
      {searchable && <div className="relative p-1 pb-2">
        <Icon name="search" size={16} className={`pointer-events-none absolute top-1/2 -translate-y-[calc(50%+4px)] text-slate-500 ${ar ? 'right-4' : 'left-4'}`} />
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((current) => Math.min(filteredOptions.length - 1, current + 1)); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((current) => Math.max(0, current - 1)); }
            else if (event.key === 'Enter' && filteredOptions[activeIndex]) { event.preventDefault(); choose(filteredOptions[activeIndex]); }
            else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); }
          }}
          className={`h-10 w-full rounded-xl border border-white/10 bg-black/40 text-sm text-slate-100 outline-none transition placeholder:text-slate-500 focus:border-orange-500/60 focus:ring-2 focus:ring-orange-500/15 ${ar ? 'pr-9 pl-3' : 'pl-9 pr-3'}`}
          placeholder={ar ? 'اكتب للبحث...' : 'Type to search...'}
        />
      </div>}
      <div role="listbox" aria-label={ariaLabel ?? (ar ? 'الخيارات' : 'Options')} className="max-h-72 overflow-y-auto rounded-xl p-0.5">
        {filteredOptions.length === 0
          ? <div className="grid justify-items-center gap-2 px-3 py-6 text-center"><Icon name="search" size={20} className="text-slate-600" /><p className="text-xs text-slate-500">{ar ? 'لا توجد نتائج مطابقة' : 'No matching results'}</p></div>
          : filteredOptions.map((option, index) => {
            const isSelected = option.value === value;
            const isActive = index === activeIndex;
            return <button
              key={option.value}
              ref={(element) => { optionRefs.current[index] = element; }}
              type="button"
              role="option"
              aria-selected={isSelected}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option)}
              className={`mb-1 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-start text-sm transition-all duration-100 last:mb-0 ${isSelected
                ? 'border-orange-500/30 bg-gradient-to-l from-orange-500/25 via-orange-500/15 to-transparent text-orange-100 shadow-sm shadow-orange-500/10'
                : isActive
                  ? 'border-white/10 bg-white/[0.07] text-white'
                  : 'border-transparent text-slate-300 hover:border-white/5 hover:bg-white/[0.05] hover:text-white'}`}
            >
              <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-lg border transition-all ${isSelected ? 'border-transparent bg-gradient-to-br from-orange-400 to-orange-600 text-[#1a1005] shadow shadow-orange-500/40' : 'border-slate-600/80 bg-black/30'}`}>
                {isSelected && <Icon name="check" size={13} />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium leading-5" title={option.label}>{option.label}</span>
                {option.description && <span className="mt-0.5 block truncate text-[11px] leading-4 text-slate-500" title={option.description}>{option.description}</span>}
              </span>
            </button>;
          })}
      </div>
    </div>}
  </div>;
}
