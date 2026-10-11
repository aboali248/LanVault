import { createContext, useCallback, useContext, useState } from 'react';
import { Icon } from '../components/Icon';

type ToastKind = 'success' | 'error' | 'info';
interface Toast { id: number; text: string; kind: ToastKind; }
interface ToastContextValue { notify: (text: string, kind?: ToastKind) => void; }

const ToastContext = createContext<ToastContextValue | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.round(Math.random() * 1000);
    setToasts((current) => [...current, { id, text, kind }]);
    window.setTimeout(() => setToasts((current) => current.filter((toast) => toast.id !== id)), 5000);
  }, []);

  return <ToastContext.Provider value={{ notify }}>
    {children}
    <div className="pointer-events-none fixed inset-x-4 bottom-5 z-[60] flex flex-col items-center gap-2 sm:items-end" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl border px-4 py-3 text-sm shadow-float ${toast.kind === 'success' ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' : toast.kind === 'error' ? 'border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200' : 'border-orange-200 bg-orange-50 text-orange-800 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-100'}`}>
          <Icon name={toast.kind === 'success' ? 'check' : toast.kind === 'error' ? 'alert' : 'info'} size={18} />
          <span>{toast.text}</span>
        </div>
      ))}
    </div>
  </ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside ToastProvider');
  return context;
}
