import { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import { de } from './de';
import { en } from './en';
import { pagesDe, pagesEn } from './registry';

export type Lang = 'de' | 'en';
const resources: Record<Lang, any> = {
  de: { ...de, ...pagesDe },
  en: { ...en, ...pagesEn },
};

interface I18nContextValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function lookup(obj: any, key: string): any {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const stored = localStorage.getItem('tf-lang');
    return stored === 'en' ? 'en' : 'de';
  });

  const setLang = useCallback((l: Lang) => {
    localStorage.setItem('tf-lang', l);
    document.documentElement.lang = l;
    setLangState(l);
  }, []);

  const t = useCallback((key: string, vars?: Record<string, string | number>) => {
    let s = lookup(resources[lang], key);
    if (s == null) s = lookup(resources.de, key); // Fallback Deutsch
    if (typeof s !== 'string') return key;         // Fallback: Schlüssel selbst
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
    return s;
  }, [lang]);

  return <I18nContext.Provider value={{ lang, setLang, t }}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const c = useContext(I18nContext);
  if (!c) throw new Error('useI18n must be used within I18nProvider');
  return c;
}

export function useT() {
  return useI18n().t;
}

// Standalone-Übersetzer für Nicht-React-Kontexte (z. B. Zustand-Stores, exportierte Helfer).
// Liest die aktuelle Sprache aus localStorage (tf-lang) statt aus dem React-Context.
export function translate(key: string, vars?: Record<string, string | number>): string {
  let lang: Lang = 'de';
  try { if (localStorage.getItem('tf-lang') === 'en') lang = 'en'; } catch { /* SSR/kein localStorage */ }
  let s = lookup(resources[lang], key);
  if (s == null) s = lookup(resources.de, key);
  if (typeof s !== 'string') return key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(new RegExp(`{{${k}}}`, 'g'), String(v));
  return s;
}
