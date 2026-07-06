import React, { useState, useRef, useEffect } from 'react';
import { ChevronDownIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useT } from '../../i18n';

interface Option {
  id: number;
  label: string;
}

interface MultiSelectDropdownProps {
  options: Option[];
  selectedValues: number[];
  onChange: (values: number[]) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
}

const MultiSelectDropdown: React.FC<MultiSelectDropdownProps> = ({
  options,
  selectedValues,
  onChange,
  placeholder,
  searchPlaceholder,
  className = ""
}) => {
  const t = useT();
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);

  const filteredOptions = options.filter(option =>
    option.label.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const selectedOptions = options.filter(option => selectedValues.includes(option.id));

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleOption = (optionId: number) => {
    if (selectedValues.includes(optionId)) {
      onChange(selectedValues.filter(id => id !== optionId));
    } else {
      onChange([...selectedValues, optionId]);
    }
  };

  const removeOption = (optionId: number) => {
    onChange(selectedValues.filter(id => id !== optionId));
  };

  const clearAll = () => {
    onChange([]);
  };

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      {/* Selected Items Display */}
      <div
        className="min-h-[42px] w-full px-3 py-2 border border-gray-300 rounded-lg bg-white cursor-pointer hover:border-gray-400 focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex flex-wrap items-center justify-between">
          <div className="flex flex-wrap gap-1 flex-1">
            {selectedOptions.length === 0 ? (
              <span className="text-slate-500 text-sm">{placeholder ?? t('ui.select')}</span>
            ) : (
              selectedOptions.map(option => (
                <span
                  key={option.id}
                  className="inline-flex items-center gap-1 px-2 py-1 bg-primary-100 text-primary-800 text-xs rounded-md"
                >
                  {option.label}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeOption(option.id);
                    }}
                    className="hover:bg-primary-200 rounded-sm p-0.5"
                  >
                    <XMarkIcon className="h-3 w-3" />
                  </button>
                </span>
              ))
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedValues.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  clearAll();
                }}
                className="text-slate-500 hover:text-slate-700 text-sm"
              >
                {t('ui.removeAll')}
              </button>
            )}
            <ChevronDownIcon 
              className={`h-4 w-4 text-slate-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
            />
          </div>
        </div>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-white border border-gray-300 rounded-lg shadow-lg max-h-64 overflow-hidden">
          {/* Search Input */}
          <div className="p-3 border-b border-gray-200">
            <div className="relative">
              <input
                type="text"
                placeholder={searchPlaceholder ?? t('ui.search')}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 pr-8 border border-gray-300 rounded-md text-sm focus:border-primary-500 focus:ring-1 focus:ring-primary-500"
                onClick={(e) => e.stopPropagation()}
              />
              {searchTerm && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setSearchTerm(''); }}
                  title={t('ui.clearInput')}
                  aria-label={t('ui.clearInput')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700 rounded"
                >
                  <XMarkIcon className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>

          {/* Options List */}
          <div className="max-h-48 overflow-y-auto">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-sm text-slate-500 text-center">
                {t('ui.noResults')}
              </div>
            ) : (
              filteredOptions.map(option => (
                <label
                  key={option.id}
                  className="flex items-center px-3 py-2 hover:bg-slate-50 cursor-pointer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <input
                    type="checkbox"
                    checked={selectedValues.includes(option.id)}
                    onChange={() => toggleOption(option.id)}
                    className="rounded border-gray-300 text-primary-600 focus:ring-primary-500 mr-2"
                  />
                  <span className="text-sm text-slate-900 flex-1">
                    {option.label}
                  </span>
                </label>
              ))
            )}
          </div>

          {/* Footer */}
          {selectedValues.length > 0 && (
            <div className="px-3 py-2 border-t border-gray-200 bg-slate-50">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span>{t('ui.selectedCount', { n: selectedValues.length })}</span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearAll();
                  }}
                  className="text-primary-600 hover:text-primary-800"
                >
                  {t('ui.removeAll')}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MultiSelectDropdown;