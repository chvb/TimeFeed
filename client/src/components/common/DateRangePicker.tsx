import { useState } from 'react';
import clsx from 'clsx';
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { useT } from '../../i18n';

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

interface Props {
  from: string;
  to: string;
  onChange: (from: string, to: string) => void;
}

/** Klick-basierter Von-Bis-Kalender: 1. Klick = Start, 2. Klick = Ende. */
export default function DateRangePicker({ from, to, onChange }: Props) {
  const t = useT();
  const MONTHS = [
    t('daterange.monthJanuary'), t('daterange.monthFebruary'), t('daterange.monthMarch'),
    t('daterange.monthApril'), t('daterange.monthMay'), t('daterange.monthJune'),
    t('daterange.monthJuly'), t('daterange.monthAugust'), t('daterange.monthSeptember'),
    t('daterange.monthOctober'), t('daterange.monthNovember'), t('daterange.monthDecember'),
  ];
  const WEEKDAYS = [
    t('daterange.weekdayMon'), t('daterange.weekdayTue'), t('daterange.weekdayWed'),
    t('daterange.weekdayThu'), t('daterange.weekdayFri'), t('daterange.weekdaySat'),
    t('daterange.weekdaySun'),
  ];
  const [view, setView] = useState(() => {
    const base = from ? new Date(from) : new Date();
    return new Date(base.getFullYear(), base.getMonth(), 1);
  });

  const year = view.getFullYear();
  const month = view.getMonth();
  const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // Montag = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: (Date | null)[] = [];
  for (let i = 0; i < firstWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));

  const handleClick = (d: Date) => {
    const s = iso(d);
    if (!from || (from && to)) {
      onChange(s, ''); // neuer Bereich – Start setzen
    } else if (s < from) {
      onChange(s, from); // früherer Klick wird Start, alter Start wird Ende
    } else {
      onChange(from, s); // Ende setzen
    }
  };

  const inRange = (d: Date) => {
    const s = iso(d);
    return !!(from && to && s >= from && s <= to);
  };
  const isEdge = (d: Date) => {
    const s = iso(d);
    return s === from || s === to;
  };
  const isToday = (d: Date) => iso(d) === iso(new Date());

  return (
    <div className="inline-block bg-white dark:bg-gray-800 border border-slate-200 dark:border-gray-700 rounded-lg p-3 shadow-sm">
      <div className="flex items-center justify-between mb-2">
        <button type="button" onClick={() => setView(new Date(year, month - 1, 1))} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-gray-700">
          <ChevronLeftIcon className="h-4 w-4" />
        </button>
        <span className="text-sm font-medium text-slate-800 dark:text-gray-200">{MONTHS[month]} {year}</span>
        <button type="button" onClick={() => setView(new Date(year, month + 1, 1))} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-gray-700">
          <ChevronRightIcon className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-[11px] text-center text-slate-400 mb-1">
        {WEEKDAYS.map((w) => <div key={w}>{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => d ? (
          <button
            key={i}
            type="button"
            onClick={() => handleClick(d)}
            className={clsx(
              'h-8 w-8 text-sm rounded transition-colors',
              isEdge(d)
                ? 'bg-primary-600 text-white font-semibold'
                : inRange(d)
                ? 'bg-primary-100 text-primary-800'
                : isToday(d)
                ? 'ring-1 ring-primary-400 text-slate-700 dark:text-gray-200'
                : 'text-slate-700 dark:text-gray-200 hover:bg-slate-100 dark:hover:bg-gray-700'
            )}
          >
            {d.getDate()}
          </button>
        ) : <div key={i} />)}
      </div>
    </div>
  );
}
