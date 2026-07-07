import { Fragment, useCallback, useEffect, useState } from 'react';
import {
  ArrowLeftIcon,
  ChevronDownIcon,
  ClockIcon,
  LockClosedIcon,
  LockOpenIcon,
  NoSymbolIcon,
  PlusIcon,
  PrinterIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import api from '../../lib/api';
import ErrorBanner from '../ErrorBanner';
import { useT, useI18n } from '../../i18n';
import { useConfirm } from '../common/ConfirmProvider';
import { useAuthStore } from '../../store/authStore';
import { formatMinutes, formatSignedMinutes, timeHHMM } from '../../lib/timeFormat';
import { printMonthTimesheet } from '../../lib/printMonthSheet';
import ManualEntryModal from './ManualEntryModal';
import TimesheetSection from './TimesheetSection';
import AbsenceBadge from '../common/AbsenceBadge';
import { useAbsenceTypes } from '../../hooks/useAbsenceTypes';

interface WorkDayRow {
  id: number;
  date: string;
  targetMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  autoBreakMinutes: number;
  balanceMinutes: number;
  status: string;
  flags?: string[];
  absence?: string | null;
  firstIn?: string | null;
  lastOut?: string | null;
}

interface TimeEntryRow {
  id: number;
  type: string;
  timestamp: string;
  source: string;
  terminal?: { id: number; name: string; locationLabel?: string | null } | null;
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

/** Stempel-Journal eines Tages mit Storno-Aktion (Zeitverwalter). */
function DayJournal({ userId, date, locked, onChanged }: { userId: number; date: string; locked: boolean; onChanged: () => void }) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const { promptInput } = useConfirm();
  const [entries, setEntries] = useState<TimeEntryRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    const [y, m, d] = date.split('-').map(Number);
    const from = new Date(y, m - 1, d, 0, 0, 0).toISOString();
    const to = new Date(y, m - 1, d + 1, 0, 0, 0).toISOString();
    api.get('/time/entries', { params: { userId, from, to } })
      .then((r) => setEntries(r.data.entries || []))
      .catch(() => setFailed(true));
  }, [userId, date]);

  useEffect(() => { load(); }, [load]);

  const cancelEntry = async (entry: TimeEntryRow) => {
    const reason = await promptInput({
      title: t('manage.cancelEntryTitle'),
      message: t('manage.cancelEntryMessage'),
      placeholder: t('manage.cancelReasonPlaceholder'),
      required: true,
    });
    if (reason == null || !reason.trim()) return;
    try {
      await api.post(`/time/entries/${entry.id}/cancel`, { reason: reason.trim() });
      toast.success(t('manage.entryCancelled'));
      load();
      onChanged();
    } catch (e: any) {
      if (e.response?.status === 423 || e.response?.data?.error === 'MONTH_LOCKED') {
        toast.error(t('manage.monthLockedError'));
      } else {
        toast.error(e.response?.data?.message || e.response?.data?.error || t('manage.cancelError'));
      }
    }
  };

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
            <span className="text-xs text-slate-400">
              {t(`time.entrySource.${e.source}`)}
              {e.source === 'terminal' && e.terminal?.name ? ` · ${e.terminal.name}` : ''}
            </span>
            {e.lat != null && e.lng != null && (
              <a
                href={`https://www.google.com/maps?q=${e.lat},${e.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-600 hover:text-green-800 inline-flex items-center gap-0.5"
                title={t('time.openMap')}
              >
                <MapPinIcon className="h-3.5 w-3.5 inline" />
              </a>
            )}
            {e.isCancelled && (
              <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-700">
                {t('time.cancelled')}{e.cancelReason ? `: ${e.cancelReason}` : ''}
              </span>
            )}
            {e.note && <span className="text-xs text-slate-500 italic">{t('time.note')}: {e.note}</span>}
            {!e.isCancelled && !locked && (
              <button
                type="button"
                onClick={() => cancelEntry(e)}
                className="inline-flex items-center gap-1 text-xs text-red-600 hover:text-red-800 hover:underline"
                title={t('manage.cancelEntry')}
              >
                <NoSymbolIcon className="h-3.5 w-3.5" /> {t('manage.cancelEntry')}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Manuelle Tages-Abwesenheit (Katalog-Select + „keine"): PUT
 * /api/time/days/:userId/:date/absence — setzt absenceSource='manual' und
 * recalct den Tag (Sollzeit-Gutschrift), null entfernt manuelle/Sync-Quellen.
 */
function DayAbsenceControl({ userId, day, variant, onChanged }: {
  userId: number;
  day: WorkDayRow;
  // Eindeutige Element-IDs: die Detailseite rendert Desktop-Tabelle UND
  // Mobile-Karten parallel (CSS blendet eine Variante aus).
  variant: 'desktop' | 'mobile';
  onChanged: () => void;
}) {
  const t = useT();
  const { types } = useAbsenceTypes();
  const [saving, setSaving] = useState(false);
  const active = types.filter((x) => x.isActive);
  // 'holiday' ist automatisch (Feiertagsservice) und nicht manuell wählbar.
  const current = day.absence && day.absence !== 'holiday' ? day.absence : '';

  const save = async (value: string) => {
    if (saving) return;
    setSaving(true);
    try {
      await api.put(`/time/days/${userId}/${day.date}/absence`, { absenceKey: value || null });
      toast.success(t('manage.absenceSaved'));
      onChanged();
    } catch (e: any) {
      if (e.response?.status === 423 || e.response?.data?.error === 'MONTH_LOCKED') {
        toast.error(t('manage.monthLockedError'));
      } else {
        toast.error(e.response?.data?.message || e.response?.data?.error || t('manage.absenceError'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <label htmlFor={`absence-${variant}-${day.date}`} className="text-sm font-medium text-slate-700 dark:text-gray-300">
        {t('manage.setAbsence')}
      </label>
      <select
        id={`absence-${variant}-${day.date}`}
        value={current}
        disabled={saving}
        onChange={(e) => save(e.target.value)}
        className="input-field w-56"
      >
        <option value="">{t('manage.absenceNone')}</option>
        {active.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
      </select>
      <AbsenceBadge absence={day.absence} />
    </div>
  );
}

interface Props {
  userId: number;
  name: string;
  month: string;
  closed: boolean;
  onBack: () => void;
  /** Übersicht neu laden (nach Buchungen/Abschluss). */
  onChanged: () => void;
}

/** Detail-Ansicht Mitarbeiter/Monat: Tages-Tabelle, Journal, Abschluss, Stundenzettel, Druck. */
export default function EmployeeMonthDetail({ userId, name, month, closed: closedInitial, onBack, onChanged }: Props) {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const { confirm } = useConfirm();
  const user = useAuthStore((s) => s.user);
  const [days, setDays] = useState<WorkDayRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDate, setManualDate] = useState<string | undefined>(undefined);
  const [closed, setClosed] = useState(closedInitial);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setClosed(closedInitial); }, [closedInitial, userId, month]);

  const canClose = !!user && (user.isSuperAdmin || user.role === 'admin' || user.role === 'buchhaltung');
  const canReopen = !!user && (user.isSuperAdmin || user.role === 'admin');
  const canDeleteTimesheet = canClose;

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.get('/time/days', { params: { userId, month } });
      setDays(r.data.days || []);
      setLoadError('');
    } catch {
      setLoadError(t('manage.detailLoadError'));
    } finally {
      setLoading(false);
    }
  }, [userId, month, t]);

  useEffect(() => { setExpanded(null); load(); }, [load]);

  const refresh = () => { load(); onChanged(); };

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

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const fmtDate = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit' });
  const fmtDayList = (list: string[]) =>
    list.map((d) => new Date(`${d}T00:00:00`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' })).join(', ');

  const closeMonth = async () => {
    const ok = await confirm({ message: t('manage.closeMonthConfirm', { month: monthLabel, name }) });
    if (!ok) return;
    try {
      setBusy(true);
      await api.post('/time/close-month', { month, userId });
      toast.success(t('manage.closeMonthSuccess'));
      setClosed(true);
      refresh();
    } catch (e: any) {
      const data = e.response?.data || {};
      if (data.error === 'INCOMPLETE_DAYS' || data.code === 'INCOMPLETE_DAYS') {
        const list: string[] = data.days || data.incompleteDays || [];
        toast.error(`${t('manage.incompleteDaysError')}\n${fmtDayList(list.map((d: any) => (typeof d === 'string' ? d : d?.date)).filter(Boolean))}`, { duration: 8000 });
      } else {
        toast.error(data.message || data.error || t('manage.closeMonthError'));
      }
    } finally {
      setBusy(false);
    }
  };

  const reopenMonth = async () => {
    const ok = await confirm({ message: t('manage.reopenMonthConfirm', { month: monthLabel, name }), danger: true });
    if (!ok) return;
    try {
      setBusy(true);
      await api.post('/time/reopen-month', { month, userId });
      toast.success(t('manage.reopenMonthSuccess'));
      setClosed(false);
      refresh();
    } catch (e: any) {
      toast.error(e.response?.data?.message || e.response?.data?.error || t('manage.reopenMonthError'));
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    printMonthTimesheet({
      employeeName: name,
      monthLabel,
      days,
      locale,
      labels: {
        title: t('manage.printTitle'),
        colDate: t('time.colDate'),
        colIn: t('time.colIn'),
        colOut: t('time.colOut'),
        colBreak: t('time.colBreak'),
        colWorked: t('time.colWorked'),
        colTarget: t('time.colTarget'),
        colBalance: t('time.colBalance'),
        colStatus: t('time.colStatus'),
        sums: t('manage.printSums'),
        signatureEmployee: t('manage.printSignatureEmployee'),
        signatureEmployer: t('manage.printSignatureEmployer'),
        closedNote: closed ? t('manage.monthClosed') : undefined,
        statusText: (d) => {
          const status = t(`time.status.${d.status}`);
          if (!d.absence) return status;
          const absKey = `time.absence.${d.absence}`;
          const abs = t(absKey) !== absKey ? t(absKey) : d.absence;
          return `${status} · ${abs}`;
        },
      },
    });
  };

  const statusBadge = (d: WorkDayRow) => (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx('status-badge', STATUS_BADGE[d.status] || 'bg-slate-100 text-slate-700')}>
        {t(`time.status.${d.status}`)}
      </span>
      <AbsenceBadge absence={d.absence} />
    </span>
  );

  return (
    <div>
      <ErrorBanner message={loadError} onRetry={load} />

      {/* Kopf: Zurück, Name/Monat, Aktionen */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <button type="button" onClick={onBack} className="btn-secondary p-2 flex-shrink-0" title={t('manage.backToOverview')} aria-label={t('manage.backToOverview')}>
            <ArrowLeftIcon className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <h2 className="text-xl font-bold text-slate-900 dark:text-white truncate">{name}</h2>
            <p className="text-sm text-slate-500 dark:text-gray-400 flex items-center gap-1.5">
              {monthLabel}
              {closed && (
                <span className="inline-flex items-center gap-1 text-purple-700 dark:text-purple-300 font-medium">
                  <LockClosedIcon className="h-4 w-4" /> {t('manage.monthClosed')}
                </span>
              )}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => { setManualDate(undefined); setManualOpen(true); }}
            disabled={closed}
            className="btn-secondary inline-flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            title={closed ? t('manage.monthClosedHint') : t('manage.addManual')}
          >
            <PlusIcon className="h-4 w-4" /> {t('manage.addManual')}
          </button>
          <button type="button" onClick={print} className="btn-secondary inline-flex items-center gap-1.5">
            <PrinterIcon className="h-4 w-4" /> {t('manage.printMonthSheet')}
          </button>
          {!closed && canClose && (
            <button type="button" onClick={closeMonth} disabled={busy} className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50">
              <LockClosedIcon className="h-4 w-4" /> {t('manage.closeMonth')}
            </button>
          )}
          {closed && canReopen && (
            <button type="button" onClick={reopenMonth} disabled={busy} className="btn-secondary inline-flex items-center gap-1.5 disabled:opacity-50">
              <LockOpenIcon className="h-4 w-4" /> {t('manage.reopenMonth')}
            </button>
          )}
        </div>
      </div>

      {closed && (
        <div className="mb-4 flex items-center gap-2 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 px-4 py-2.5 text-sm text-purple-800 dark:text-purple-200">
          <LockClosedIcon className="h-5 w-5 flex-shrink-0" />
          {t('manage.monthClosedHint')}
        </div>
      )}

      {loading ? (
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
          {/* Desktop: Tabelle */}
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
                      <tr className="hover:bg-slate-50 cursor-pointer" onClick={() => setExpanded(expanded === d.date ? null : d.date)}>
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-gray-100">{fmtDate(d.date)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-slate-700 dark:text-gray-300">{timeHHMM(d.firstIn, locale)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-slate-700 dark:text-gray-300">{timeHHMM(d.lastOut, locale)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right text-slate-700 dark:text-gray-300">{formatMinutes(d.breakMinutes + d.autoBreakMinutes)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right font-medium text-slate-900 dark:text-gray-100">{formatMinutes(d.workedMinutes)}</td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right text-slate-700 dark:text-gray-300">{formatMinutes(d.targetMinutes)}</td>
                        <td className={clsx('px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right font-medium', d.balanceMinutes < 0 ? 'text-red-600' : 'text-green-600')}>
                          {formatSignedMinutes(d.balanceMinutes)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm">{statusBadge(d)}</td>
                        <td className="px-2 py-3 text-right">
                          <ChevronDownIcon className={clsx('h-4 w-4 inline text-slate-500 transition-transform', expanded === d.date && 'rotate-180')} />
                        </td>
                      </tr>
                      {expanded === d.date && (
                        <tr>
                          <td colSpan={9} className="px-4 py-3 bg-slate-50 dark:bg-gray-800/50">
                            <DayJournal userId={userId} date={d.date} locked={closed || d.status === 'locked'} onChanged={refresh} />
                            {!closed && d.status !== 'locked' && (
                              <>
                                <DayAbsenceControl userId={userId} day={d} variant="desktop" onChanged={refresh} />
                                <button
                                  type="button"
                                  onClick={() => { setManualDate(d.date); setManualOpen(true); }}
                                  className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-800 hover:underline"
                                >
                                  <PlusIcon className="h-4 w-4" /> {t('manage.addManual')}
                                </button>
                              </>
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
                    <td className={clsx('px-4 py-3 text-sm tabular-nums text-right font-semibold', sums.balance < 0 ? 'text-red-600' : 'text-green-600')}>
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
                <button type="button" className="w-full text-left" onClick={() => setExpanded(expanded === d.date ? null : d.date)}>
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
                    <DayJournal userId={userId} date={d.date} locked={closed || d.status === 'locked'} onChanged={refresh} />
                    {!closed && d.status !== 'locked' && (
                      <>
                        <DayAbsenceControl userId={userId} day={d} variant="mobile" onChanged={refresh} />
                        <button
                          type="button"
                          onClick={() => { setManualDate(d.date); setManualOpen(true); }}
                          className="mt-3 inline-flex items-center gap-1.5 text-sm text-primary-600 hover:text-primary-800 hover:underline"
                        >
                          <PlusIcon className="h-4 w-4" /> {t('manage.addManual')}
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            <div className="card border-2 border-primary-200">
              <p className="font-semibold text-slate-900 dark:text-gray-100 mb-2">{t('time.sumRow')} · {monthLabel}</p>
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

      {/* Stundenzettel-Dokumente */}
      <TimesheetSection userId={userId} month={month} canDelete={canDeleteTimesheet} />

      <ManualEntryModal
        open={manualOpen}
        onClose={() => setManualOpen(false)}
        userId={userId}
        defaultDate={manualDate}
        onBooked={refresh}
      />
    </div>
  );
}
