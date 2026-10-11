import { useEffect } from 'react';
import { Icon } from './Icon';
import { useApp } from '../contexts/AppContext';

export function Modal({ open, onClose, title, children, size = 'md' }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; size?: 'sm' | 'md' | 'lg' | 'xl' }) {
  const { t, language } = useApp();
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  const widths = { sm: 'max-w-md', md: 'max-w-xl', lg: 'max-w-3xl', xl: 'max-w-5xl' };
  const contentDirection = language === 'ar' ? 'rtl' : 'ltr';
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section dir="ltr" className={`max-h-[92vh] w-full ${widths[size]} animate-fade-up overflow-auto rounded-t-[1.6rem] bg-white shadow-float dark:bg-slate-900 sm:rounded-[1.6rem]`}>
      <header dir={contentDirection} className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white/95 px-5 py-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
        <h2 className="text-base font-bold text-slate-800 dark:text-white">{title}</h2>
        <button type="button" className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" onClick={onClose} aria-label={t('close')}><Icon name="close" /></button>
      </header>
      <div dir={contentDirection} className="p-5">{children}</div>
    </section>
  </div>;
}
