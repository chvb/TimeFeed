import { useState } from 'react';
import { Combobox } from '@headlessui/react';
import { ChevronUpDownIcon } from '@heroicons/react/24/outline';
import { normalizeText } from '../../lib/normalize';
import { useT } from '../../i18n';

export interface SelectOption { value: string; label: string }

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

// Tippbares Auswahlfeld (Dropdown mit Sofort-Filterung). Ersetzt <select>, wo die
// Liste lang werden kann und der Nutzer per Texteingabe filtern soll.
export default function SearchableSelect({ value, onChange, options, placeholder, disabled, className = '' }: Props) {
  const t = useT();
  const [query, setQuery] = useState('');
  const selected = options.find((o) => o.value === value) || null;
  const filtered = query.trim() === ''
    ? options
    : options.filter((o) => normalizeText(o.label).includes(normalizeText(query)));

  return (
    <Combobox value={selected} onChange={(o: SelectOption | null) => onChange(o ? o.value : '')} disabled={disabled}>
      <div className={`relative ${className}`}>
        <div className="relative">
          <Combobox.Input
            className="input-field pr-9"
            displayValue={(o: SelectOption | null) => (o ? o.label : '')}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder ?? t('ui.select')}
          />
          <Combobox.Button className="absolute inset-y-0 right-0 flex items-center pr-2">
            <ChevronUpDownIcon className="h-5 w-5 text-gray-400" />
          </Combobox.Button>
        </div>
        <Combobox.Options className="absolute z-30 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white dark:bg-gray-800 py-1 text-sm shadow-lg ring-1 ring-black/5 focus:outline-none">
          {filtered.length === 0 ? (
            <div className="px-3 py-2 text-gray-500 dark:text-gray-400">{t('ui.noMatches')}</div>
          ) : (
            filtered.map((o) => (
              <Combobox.Option
                key={o.value}
                value={o}
                className={({ active }) => `cursor-pointer px-3 py-2 ${active ? 'bg-primary-50 text-primary-700 dark:bg-gray-700 dark:text-white' : 'text-slate-700 dark:text-gray-200'}`}
              >
                {o.label}
              </Combobox.Option>
            ))
          )}
        </Combobox.Options>
      </div>
    </Combobox>
  );
}
