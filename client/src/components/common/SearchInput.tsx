import { MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useT } from '../../i18n';

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Zusätzliche Klassen für den äußeren Container (z. B. Breite). */
  className?: string;
}

/** Suchfeld mit Lupen-Icon und X-Button zum Zurücksetzen der Eingabe. */
export default function SearchInput({ value, onChange, placeholder, className = '' }: SearchInputProps) {
  const t = useT();
  return (
    <div className={`relative ${className}`}>
      <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? t('ui.search')}
        className="w-full pl-9 pr-9 py-2 text-sm border border-gray-300 rounded-lg bg-white dark:bg-gray-800 dark:border-gray-700 focus:border-primary-500 focus:ring-1 focus:ring-primary-500 transition-colors"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          title={t('ui.clearInput')}
          aria-label={t('ui.clearInput')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700 dark:hover:text-gray-200 rounded"
        >
          <XMarkIcon className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
