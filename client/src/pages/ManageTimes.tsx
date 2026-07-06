import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LockClosedIcon,
  ShieldCheckIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import ErrorBanner from '../components/ErrorBanner';
import SearchInput from '../components/common/SearchInput';
import { useT, useI18n } from '../i18n';
import { formatMinutes, formatSignedMinutes } from '../lib/timeFormat';
import EmployeeMonthDetail from '../components/manage/EmployeeMonthDetail';
import CorrectionsAdminTab from '../components/manage/CorrectionsAdminTab';

// Server-Contract (GET /api/time/month-overview): { month, users: [ … ] }
interface OverviewRow {
  userId: number;
  name?: string;
  firstName?: string;
  lastName?: string;
  targetMinutes: number;
  workedMinutes: number;
  balanceMinutes: number;
  incompleteDays: number;
  flaggedDays: number;
  openCorrections: number;
  closed: boolean;
}

function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Ampel: rot (unvollständig/auffällig) > gelb (offene Anträge) > grün. */
function trafficOf(r: OverviewRow): 'red' | 'yellow' | 'green' {
  if ((r.incompleteDays || 0) > 0 || (r.flaggedDays || 0) > 0) return 'red';
  if ((r.openCorrections || 0) > 0) return 'yellow';
  return 'green';
}

const TRAFFIC_DOT: Record<string, string> = {
  red: 'bg-red-500',
  yellow: 'bg-amber-400',
  green: 'bg-green-500',
};

/** Seite „Zeiten verwalten": Monatsübersicht aller Mitarbeiter, Detail-Ansicht, Korrekturanträge. */
export default function ManageTimes() {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const [tab, setTab] = useState<'overview' | 'corrections'>('overview');
  const [month, setMonth] = useState(currentMonth);
  const [rows, setRows] = useState<OverviewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<OverviewRow | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await api.get('/time/month-overview', { params: { month } });
      setRows(r.data.users || []);
      setLoadError('');
    } catch {
      setLoadError(t('manage.loadError'));
    } finally {
      setLoading(false);
    }
  }, [month, t]);

  useEffect(() => { load(); }, [load]);
  // Monatswechsel schließt die Detail-Ansicht nicht — die gewählte Person bleibt offen,
  // aber ihr closed-Status muss zur neuen Übersicht passen.
  useEffect(() => {
    setSelected((sel) => (sel ? rows.find((r) => r.userId === sel.userId) || null : null));
  }, [rows]);

  const nameOf = (r: OverviewRow) => r.name || `${r.firstName || ''} ${r.lastName || ''}`.trim() || `#${r.userId}`;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => nameOf(r).toLowerCase().includes(q));
  }, [rows, search]);

  const monthLabel = new Date(`${month}-01T00:00:00`).toLocaleDateString(locale, { month: 'long', year: 'numeric' });

  const trafficTitle = (r: OverviewRow) => {
    const tr = trafficOf(r);
    if (tr === 'red') return t('manage.trafficRed');
    if (tr === 'yellow') return t('manage.trafficYellow');
    return t('manage.trafficGreen');
  };

  const trafficDetail = (r: OverviewRow) => {
    const parts: string[] = [];
    if (r.incompleteDays > 0) parts.push(t('manage.incompleteDaysShort', { count: r.incompleteDays }));
    if (r.flaggedDays > 0) parts.push(t('manage.flaggedDaysShort', { count: r.flaggedDays }));
    if (r.openCorrections > 0) parts.push(t('manage.openCorrectionsShort', { count: r.openCorrections }));
    return parts.join(' · ');
  };

  // Client-seitiger Rollen-Guard (API liefert ohnehin 403 — hier saubere Meldung
  // statt Fehlbanner, analog TimeModels/Exports; E2E-Befund).
  const { user } = useAuthStore();
  if (user && !['admin', 'buchhaltung', 'verwaltung'].includes(user.role) && !user.isSuperAdmin) {
    return (
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-3">{t('manage.title')}</h1>
        <div className="card text-center">
          <ShieldCheckIcon className="h-12 w-12 text-slate-500 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-slate-900 dark:text-white mb-2">{t('manage.accessDeniedTitle')}</h3>
          <p className="text-slate-600 dark:text-gray-400">{t('manage.accessDeniedText')}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t('manage.title')}</h1>
        {tab === 'overview' && !selected && (
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="btn-secondary p-2" aria-label={t('time.prevMonth')} title={t('time.prevMonth')}>
              <ChevronLeftIcon className="h-5 w-5" />
            </button>
            <label className="sr-only" htmlFor="manage-month-picker">{t('time.month')}</label>
            <input
              id="manage-month-picker"
              type="month"
              value={month}
              onChange={(e) => { if (e.target.value) setMonth(e.target.value); }}
              className="input-field w-44"
            />
            <button type="button" onClick={() => setMonth((m) => shiftMonth(m, 1))} className="btn-secondary p-2" aria-label={t('time.nextMonth')} title={t('time.nextMonth')}>
              <ChevronRightIcon className="h-5 w-5" />
            </button>
          </div>
        )}
      </div>

      {/* Reiter Übersicht / Korrekturanträge */}
      <div className="border-b border-gray-200 dark:border-gray-700 mb-4">
        <nav className="-mb-px flex gap-6">
          {(['overview', 'corrections'] as const).map((tb) => (
            <button
              key={tb}
              type="button"
              onClick={() => { setTab(tb); if (tb === 'corrections') setSelected(null); }}
              className={clsx(
                'py-2.5 px-1 border-b-2 text-sm font-medium transition-colors',
                tab === tb
                  ? 'border-primary-600 text-primary-600'
                  : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-gray-300'
              )}
            >
              {t(tb === 'overview' ? 'manage.tabOverview' : 'manage.tabCorrections')}
            </button>
          ))}
        </nav>
      </div>

      {tab === 'corrections' ? (
        <CorrectionsAdminTab onChanged={load} />
      ) : selected ? (
        <EmployeeMonthDetail
          userId={selected.userId}
          name={nameOf(selected)}
          month={month}
          closed={!!selected.closed}
          onBack={() => setSelected(null)}
          onChanged={load}
        />
      ) : (
        <>
          <ErrorBanner message={loadError} onRetry={load} />
          <div className="mb-4 max-w-sm">
            <SearchInput value={search} onChange={setSearch} placeholder={t('manage.searchPlaceholder')} />
          </div>

          {loading ? (
            <div className="card">
              <div className="animate-pulse space-y-3">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className="h-4 bg-gray-300 dark:bg-gray-600 rounded" />
                ))}
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="card text-center py-12">
              <UsersIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
              <p className="text-slate-600 dark:text-gray-400">{t('manage.noEmployees')}</p>
            </div>
          ) : (
            <>
              {/* Desktop: Tabelle */}
              <div className="card overflow-hidden hidden md:block">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('manage.colState')}</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-slate-600 uppercase tracking-wider">{t('manage.colEmployee')}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colTarget')}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colWorked')}</th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-slate-600 uppercase tracking-wider">{t('time.colBalance')}</th>
                        <th className="px-4 py-3" />
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {filtered.map((r) => (
                        <tr key={r.userId} className="hover:bg-slate-50 cursor-pointer" onClick={() => setSelected(r)}>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="inline-flex items-center gap-2" title={trafficTitle(r)}>
                              <span className={clsx('h-3 w-3 rounded-full inline-block', TRAFFIC_DOT[trafficOf(r)])} />
                              <span className="text-xs text-slate-500 hidden lg:inline">{trafficDetail(r)}</span>
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-slate-900 dark:text-gray-100">
                            <span className="inline-flex items-center gap-2">
                              {nameOf(r)}
                              {r.closed && (
                                <span className="status-badge bg-purple-100 text-purple-800 inline-flex items-center gap-1">
                                  <LockClosedIcon className="h-3 w-3" /> {t('manage.closedBadge')}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right text-slate-700 dark:text-gray-300">{formatMinutes(r.targetMinutes)}</td>
                          <td className="px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right font-medium text-slate-900 dark:text-gray-100">{formatMinutes(r.workedMinutes)}</td>
                          <td className={clsx('px-4 py-3 whitespace-nowrap text-sm tabular-nums text-right font-medium', r.balanceMinutes < 0 ? 'text-red-600' : 'text-green-600')}>
                            {formatSignedMinutes(r.balanceMinutes)}
                          </td>
                          <td className="px-2 py-3 text-right">
                            <ChevronRightIcon className="h-4 w-4 inline text-slate-400" aria-hidden="true" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile: Card-Liste */}
              <div className="md:hidden space-y-3">
                {filtered.map((r) => (
                  <button key={r.userId} type="button" className="card w-full text-left" onClick={() => setSelected(r)}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-2 min-w-0">
                        <span className={clsx('h-3 w-3 rounded-full inline-block flex-shrink-0', TRAFFIC_DOT[trafficOf(r)])} title={trafficTitle(r)} />
                        <span className="font-semibold text-slate-900 dark:text-gray-100 truncate">{nameOf(r)}</span>
                      </span>
                      {r.closed && (
                        <span className="status-badge bg-purple-100 text-purple-800 inline-flex items-center gap-1 flex-shrink-0">
                          <LockClosedIcon className="h-3 w-3" /> {t('manage.closedBadge')}
                        </span>
                      )}
                    </div>
                    {trafficDetail(r) && <p className="mt-0.5 text-xs text-slate-500 dark:text-gray-400">{trafficDetail(r)}</p>}
                    <div className="mt-2 grid grid-cols-3 gap-x-3 text-sm">
                      <span className="text-slate-500">{t('time.colTarget')}<br /><span className="tabular-nums text-slate-800 dark:text-gray-200">{formatMinutes(r.targetMinutes)}</span></span>
                      <span className="text-slate-500">{t('time.colWorked')}<br /><span className="tabular-nums text-slate-800 dark:text-gray-200">{formatMinutes(r.workedMinutes)}</span></span>
                      <span className="text-slate-500">{t('time.colBalance')}<br /><span className={clsx('tabular-nums font-medium', r.balanceMinutes < 0 ? 'text-red-600' : 'text-green-600')}>{formatSignedMinutes(r.balanceMinutes)}</span></span>
                    </div>
                  </button>
                ))}
              </div>

              <p className="mt-3 text-xs text-slate-400">{monthLabel} · {filtered.length}</p>
            </>
          )}
        </>
      )}
    </div>
  );
}
