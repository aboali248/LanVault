import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { Language } from '../types';
import { dictionaries, type TranslationKey } from '../i18n';

interface AppContextValue {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: TranslationKey) => string;
}

const AppContext = createContext<AppContextValue | undefined>(undefined);

function getInitialLanguage(): Language {
  const stored = localStorage.getItem('lanvault-language');
  return stored === 'en' || stored === 'ar' ? stored : 'ar';
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = 'ltr';
    document.body.dir = language === 'ar' ? 'rtl' : 'ltr';
    document.getElementById('root')?.setAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
    localStorage.setItem('lanvault-language', language);
  }, [language]);

  useEffect(() => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('lanvault-theme', 'dark');
  }, []);

  const value = useMemo<AppContextValue>(() => ({
    language,
    setLanguage: setLanguageState,
    t: (key) => dictionaries[language][key],
  }), [language]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) throw new Error('useApp must be used inside AppProvider');
  return context;
}
