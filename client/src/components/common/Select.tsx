import { useEffect, useRef, useState } from 'react';

export interface SelectOption { value: string; label: string; group?: string }

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  className?: string;
  /** Ersetzt das Standard-`input-field`-Styling des Auslösers (z. B. für den Header-Umschalter). */
  triggerClassName?: string;
  disabled?: boolean;
  ariaLabel?: string;
  title?: string;
}

/**
 * Schönes, mobil-freundliches Dropdown als Ersatz für das native <select> (das auf dem
 * Handy den grauen OS-Picker öffnet). Nutzt die App-Styles (input-field), unterstützt
 * Dark-Mode, optionale Gruppen-Header (option.group), schließt bei Klick außerhalb / Escape
 * und ist tastatur-/screenreader-tauglich.
 */
export default function Select({ value, onChange, options, className = '', triggerClassName, disabled, ariaLabel, title }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const selected = options.find((o) => o.value === value);
  const trigger = triggerClassName ?? 'input-field';

  let lastGroup: string | undefined;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        onClick={() => setOpen((o) => !o)}
        className={`${trigger} flex items-center justify-between gap-2 text-left disabled:opacity-60 ${className}`}
      >
        <span className="truncate">{selected ? selected.label : ''}</span>
        <svg className={`h-4 w-4 flex-shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <ul role="listbox" className="absolute z-30 mt-1 max-h-72 min-w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg dark:border-gray-700 dark:bg-gray-800">
          {options.map((o) => {
            const header = o.group && o.group !== lastGroup ? o.group : null;
            lastGroup = o.group;
            return (
              <li key={o.value} role="option" aria-selected={o.value === value}>
                {header && (
                  <div className="px-3 pt-2 pb-1 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-gray-500">{header}</div>
                )}
                <button
                  type="button"
                  onClick={() => { onChange(o.value); setOpen(false); }}
                  className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    o.value === value
                      ? 'bg-primary-50 font-medium text-primary-700 dark:bg-primary-900/30 dark:text-primary-200'
                      : 'text-slate-700 hover:bg-slate-100 dark:text-gray-200 dark:hover:bg-gray-700'
                  }`}
                >
                  <span className="truncate">{o.label}</span>
                  {o.value === value && (
                    <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0L3.3 10.7a1 1 0 011.42-1.42l3.29 3.3 6.79-6.8a1 1 0 011.42 0z" clipRule="evenodd" /></svg>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
