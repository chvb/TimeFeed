import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  MapPinIcon,
  PencilSquareIcon,
  ScissorsIcon,
  SparklesIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import { useT, useI18n } from '../i18n';
import { formatMinutes, formatSignedMinutes, timeHHMM } from '../lib/timeFormat';
import CorrectionRequestModal from '../components/time/CorrectionRequestModal';
import MyCorrectionsList from '../components/time/MyCorrectionsList';

interface WorkDayRow {
  id: number;
  date: string;
  targetMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  autoBreakMinutes: number;
  balanceMinutes: number;
  status: 'open' | 'incomplete' | 'ok' | 'flagged' | 'approved' | 'locked' | string;
  flags?: string[];
  absence?: string | null;
  firstIn?: string | null;
  lastOut?: string | null;
}

interface TimeEntryRow {
  id: number;
  type: 'in' | 'out' | 'break_start' | 'break_end' | string;
  timestamp: string;
  source: string;
  lat?: number | null;
  lng?: number | null;
  isCancelled: boolean;
  cancelReason?: string | null;
  note?: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  open: 'bg-slate-100 text-slate-700',
  incomplete: 'bg-amber-100 text-amber-800',
  ok: 'bg-green-100 text-green-800',
  flagged: 'bg-red-100 text-red-800',
  approved: 'bg-blue-100 text-blue-800',
  locked: 'bg-purple-100 text-purple-800',
};

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Flag-/Status-Icons mit Tooltip (title). */
function DayFlags({ day, t }: { day: WorkDayRow; t: (k: string, v?: any) => string }) {
  const flags = day.flags || [];
  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {day.status === 'incomplete' && (
        <ExclamationTriangleIcon className="h-4 w-4 text-amber-500" title={t('time.flags.incomplete')} />
      )}
      {flags.includes('arbzg_over_10h') && (
        <ExclamationTriangleIcon className="h-4 w-4 text-red-500" title={t('time.flags.arbzg_over_10h')} />
      )}
      {flags.includes('arbzg_rest_violation') && (
        <ExclamationTriangleIcon className="h-4 w-4 text-red-500" title={t('time.flags.arbzg_rest_violation')} />
      )}
      {flags.includes('auto_capped') && (
        <ScissorsIcon className="h-4 w-4 text-amber-500" title={t('time.flags.auto_capped')} />
      )}
      {flags.includes('no_gps') && (
        <MapPinIcon className="h-4 w-4 text-slate-400" title={t('time.flags.no_gps')} />
      )}
      {flags.includes('target_credited') && (
        <SparklesIcon className="h-4 w-4 text-primary-500" title={t('time.flags.target_credited')} />
      )}
    </span>
  );
}

/** Stempel-Journal eines Tages (inkl. stornierter Einträge). */
function DayEntries({ date }: { date: string }) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const [entries, setEntries] = useState<TimeEntryRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const [y, m, d] = date.split('-').map(Number);
    const from = new Date(y, m - 1, d, 0, 0, 0).toISOString();
    const to = new Date(y, m - 1, d + 1, 0, 0, 0).toISOString();
    api.get('/time/entries', { params: { from, to } })
      .then((r) => { if (active) setEntries(r.data.entries || []); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [date]);

  if (failed) return <p className="text-sm text-red-600">{t('time.entriesLoadError')}</p>;
  if (entries === null) return <p className="text-sm text-slate-500">{t('time.entriesLoading')}</p>;
  if (entries.length === 0) return <p className="text-sm text-slate-500">{t('time.entriesEmpty')}</p>;

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-gray-400 mb-2">{t('time.entriesTitle')}</p>
      <ul className="space-y-1.5">
        {entries.map((e) => (
          <li key={e.id} className={clsx('flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm', e.isCancelled && 'opacity-60')}>
            <span className={clsx('tabular-nums font-medium text-slate-800 dark:text-gray-200', e.isCancelled && 'line-through')}>
              {new Date(e.timestamp).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </span>
            <span className={clsx('text-slate-700 dark:text-gray-300', e.isCancelled && 'line-through')}>
              {t(`time.entryType.${e.type}`)}
            </span>
            <span className="text-xs text-slate-400">{t(`time.entrySource.${e.source}`)}</span>
            <span className="text-xs text-slate-400" title={e.lat != null && e.lng != null ? t('time.withGps') : t('time.withoutGps')}>
              <MapPinIcon className={clsx('h-3.5 w-3.5 inline', e.lat != null && e.lng != null ? 'text-green-500' : 'text-slate-300')} />
            </span>
            {e.isCancelled && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                {t('time.cancelled')}{e.cancelReason ? `: ${e.cancelReason}` : ''}
              </span>
            )}
            {e.note && <span className="text-xs text-slate-500 italic">{t('time.note')}: {e.note}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Meine Zeiten: Monatsübersicht der WorkDays mit Summenzeile und Detail-Journal. */
export default function MyTimes() {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const [month, setMonth] = useState(currentMonth);
  const [days, setDays] = useState<WorkDayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [tab, setTab] = useState<'days' | 'requests'>('days');
  const [correctionDate, setCorrectionDate] = useState<string | null>(null);
  const [correctionsReload, setCorrectionsReload] = useState(0);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.get('/time/days', { params: { month } });
      setDays(r.data.days || []);
      setLoadError('');
    } catch (error) {
      console.error('Error loading work days:', error);
      setLoadError(t('time.loadError'));
    } finally {
      setLoading(false);
    }
  }, [month, t]);

  useEffect(() => { setExpanded(null); load(); }, [load]);

  const sums = days.reduce(
    (acc, d) => {
      acc.target += d.targetMinutes;
      acc.worked += d.workedMinutes;
      acc.balance += d.balanceMinutes;
      acc.breaks += d.breakMinutes + d.autoBreakMinutes;
      return acc;
    },
    { target: 0, worked: 0, balance: 0, breaks: 0 }
  );

  const fmtDate = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit' });

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  const totalBreak = (d: WorkDayRow) => d.breakMinutes + d.autoBreakMinutes;

  const statusBadge = (d: WorkDayRow) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx('status-badge', STATUS_BADGE[d.status] || 'bg-slate-100 text-slate-700')}>
        {t(`time.status.${d.status}`)}
      </span>
      {d.absence && (
        <span className="status-badge bg-primary-100 text-primary-800">
          {t(`time.absence.${d.absence}`) !== `time.absence.${d.absence}` ? t(`time.absence.${d.absence}`) : d.absence}
        </span>
      )}
      <DayFlags day={d} t={t} />
    </span>
  );

  return (
    <div>
      <ErrorBanner message={loadError} onRetry={load} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t('time.myTimesTitle')}</h1>
        {tab === 'days' && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, -1))}
            className="btn-secondary p-2"
            aria-label={t('time.prevMonth')}
            title={t('time.prevMonth')}
          >
            <ChevronLeftIcon className="h-5 w-5" />
          </button>
          <label className="sr-only" htmlFor="month-picker">{t('time.month')}</label>
          <input
            id="month-picker"
            type="month"
            value={month}
            onChange={(e) => { if (e.target.value) setMonth(e.target.value); }}
            className="input-field w-44"
          />
          <button
            type="button"
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            className="btn-secondary p-2"
            aria-label={t('time.nextMonth')}
            title={t('time.nextMonth')}
          >
            <ChevronRightIcon className="h-5 w-5" />
          </button>
        </div>
        )}
      </div>

      {/* Reiter: Monatsübersicht / Meine Korrekturanträge */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-4">
        <nav className="-mb-px flex gap-6">
          {(['days', 'requests'] as const).map((tb) => (
            <button
              key={tb}
              type="button"
              onClick={() => setTab(tb)}
              className={clsx(
                'py-2.5 px-1 border-b-2 text-sm font-medium transition-colors',
                tab === tb
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-gray-300'
              )}
            >
              {t(tb === 'days' ? 'corrections.tabDays' : 'corrections.myRequests')}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'requests' ? (
        <MyCorrectionsList reloadKey={correctionsReload} />
      ) : loading ? (
        <div className="card">
          <div className="animate-pulse space-y-3">
            {[...Array(6)].map((_, i) => (
              <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded" />
            ))}
          </div>
        </div>
      ) : days.length === 0 ? (
        <div className="card text-center py-12">
          <ClockIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <p className="text-slate-600 dark:text-gray-400">{t('time.noDays')}</p>
        </div>
      ) : (
        <>
          {/* Desktop: Tabelle (horizontal scrollbar im eigenen Container) */}
          <div className="card overflow-hidden hidden md:block">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colDate')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colIn')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colOut')}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colBreak')}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colWorked')}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colTarget')}</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colBalance')}</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colStatus')}</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {days.map((d) => (
                    <Fragment key={d.id}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-gray-100">{fmtDate(d.date)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-slate-700 dark:text-gray-300">{timeHHMM(d.firstIn, locale)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-slate-700 dark:text-gray-300">{timeHHMM(d.lastOut, locale)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right text-slate-700 dark:text-gray-300">{formatMinutes(totalBreak(d))}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right font-medium text-slate-900 dark:text-gray-100">{formatMinutes(d.workedMinutes)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right text-slate-700 dark:text-gray-300">{formatMinutes(d.targetMinutes)}</td>
                        <td className={clsx(
                          'px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right font-medium',
                          d.balanceMinutes < 0 ? 'text-red-600' : 'text-green-600'
                        )}>
                          {formatSignedMinutes(d.balanceMinutes)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">{statusBadge(d)}</td>
                        <td className="px-2 py-3 text-right whitespace-nowrap">
                          {d.status !== 'locked' && (
                            <button
                              type="button"
                              onClick={() => setCorrectionDate(d.date)}
                              className="p-1 rounded hover:bg-slate-100 text-slate-500"
                              title={t('corrections.request')}
                              aria-label={t('corrections.request')}
                            >
                              <PencilSquareIcon className="h-4 w-4" />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setExpanded(expanded === d.date ? null : d.date)}
                            className="p-1 rounded hover:bg-slate-100 text-slate-500"
                            title={expanded === d.date ? t('time.hideEntries') : t('time.showEntries')}
                            aria-label={expanded === d.date ? t('time.hideEntries') : t('time.showEntries')}
                          >
                            <ChevronDownIcon className={clsx('h-4 w-4 transition-transform', expanded === d.date && 'rotate-180')} />
                          </button>
                        </td>
                      </tr>
                      {expanded === d.date && (
                        <tr>
                          <td colSpan={9} className="px-4 py-3 bg-slate-50 dark:bg-gray-800/50">
                            <DayEntries date={d.date} />
                            {d.status !== 'locked' && (
                              <button
                                type="button"
                                onClick={() => setCorrectionDate(d.date)}
                                className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-800 hover:underline"
                              >
                                <PencilSquareIcon className="h-4 w-4" /> {t('corrections.request')}
                              </button>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
                <tfoot className="bg-slate-50 border-t-2 border-gray-300">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 text-sm font-semibold text-slate-900 dark:text-gray-100">
                      {t('time.sumRow')} · {monthLabel} · {t('time.daysCount', { count: days.length })}
                    </td>
                    <td className="px-4 py-3 text-sm tabular-nums text-right font-semibold text-slate-900 dark:text-gray-100">{formatMinutes(sums.breaks)}</td>
                    <td className="px-4 py-3 text-sm tabular-nums text-right font-semibold text-slate-900 dark:text-gray-100">{formatMinutes(sums.worked)}</td>
                    <td className="px-4 py-3 text-sm tabular-nums text-right font-semibold text-slate-900 dark:text-gray-100">{formatMinutes(sums.target)}</td>
                    <td className={clsx(
                      'px-4 py-3 text-sm tabular-nums text-right font-semibold',
                      sums.balance < 0 ? 'text-red-600' : 'text-green-600'
                    )}>
                      {formatSignedMinutes(sums.balance)}
                    </td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Mobile: Card-Liste */}
          <div className="md:hidden space-y-3">
            {days.map((d) => (
              <div key={d.id} className="card">
                <button
                  type="button"
                  className="w-full text-left"
                  onClick={() => setExpanded(expanded === d.date ? null : d.date)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900 dark:text-gray-100">{fmtDate(d.date)}</span>
                    <span className="flex items-center gap-2">
                      {statusBadge(d)}
                      <ChevronDownIcon className={clsx('h-4 w-4 text-slate-400 transition-transform', expanded === d.date && 'rotate-180')} />
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                    <span className="text-slate-500">{t('time.colIn')} / {t('time.colOut')}</span>
                    <span className="tabular-nums text-right text-slate-800 dark:text-gray-200">{timeHHMM(d.firstIn, locale)} – {timeHHMM(d.lastOut, locale)}</span>
                    <span className="text-slate-500">{t('time.colBreak')}</span>
                    <span className="tabular-nums text-right text-slate-800 dark:text-gray-200">{formatMinutes(totalBreak(d))}</span>
                    <span className="text-slate-500">{t('time.colWorked')} / {t('time.colTarget')}</span>
                    <span className="tabular-nums text-right text-slate-800 dark:text-gray-200">{formatMinutes(d.workedMinutes)} / {formatMinutes(d.targetMinutes)}</span>
                    <span className="text-slate-500">{t('time.colBalance')}</span>
                    <span className={clsx('tabular-nums text-right font-medium', d.balanceMinutes < 0 ? 'text-red-600' : 'text-green-600')}>
                      {formatSignedMinutes(d.balanceMinutes)}
                    </span>
                  </div>
                </button>
                {expanded === d.date && (
                  <div className="mt-3 pt-3 border-t border-gray-200 dark:border-gray-700">
                    <DayEntries date={d.date} />
                    {d.status !== 'locked' && (
                      <button
                        type="button"
                        onClick={() => setCorrectionDate(d.date)}
                        className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-800 hover:underline"
                      >
                        <PencilSquareIcon className="h-4 w-4" /> {t('corrections.request')}
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}

            {/* Monatssumme (mobil) */}
            <div className="card border-2 border-primary-200">
              <p className="font-semibold text-slate-900 dark:text-gray-100 mb-2">
                {t('time.sumRow')} · {monthLabel}
              </p>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <span className="text-slate-500">{t('time.colBreak')}</span>
                <span className="tabular-nums text-right text-slate-800 dark:text-gray-200">{formatMinutes(sums.breaks)}</span>
                <span className="text-slate-500">{t('time.colWorked')}</span>
                <span className="tabular-nums text-right text-slate-800 dark:text-gray-200">{formatMinutes(sums.worked)}</span>
                <span className="text-slate-500">{t('time.colTarget')}</span>
                <span className="tabular-nums text-right text-slate-800 dark:text-gray-200">{formatMinutes(sums.target)}</span>
                <span className="text-slate-500">{t('time.colBalance')}</span>
                <span className={clsx('tabular-nums text-right font-semibold', sums.balance < 0 ? 'text-red-600' : 'text-green-600')}>
                  {formatSignedMinutes(sums.balance)}
                </span>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Korrektur beantragen (pro Tag) */}
      {correctionDate && (
        <CorrectionRequestModal
          open={!!correctionDate}
          onClose={() => setCorrectionDate(null)}
          date={correctionDate}
          onSubmitted={() => setCorrectionsReload((k) => k + 1)}
        />
      )}
    </div>
  );
}
