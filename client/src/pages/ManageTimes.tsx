import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  LockClosedIcon,
  LockOpenIcon,
  ShieldCheckIcon,
  UsersIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import ErrorBanner from '../components/ErrorBanner';
import SearchInput from '../components/common/SearchInput';
import { useConfirm } from '../components/common/ConfirmProvider';
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
  const { confirm } = useConfirm();
  const [bulkBusy, setBulkBusy] = useState(false);
  // Blockierende Tage aus einem gescheiterten Firmen-Abschluss (400 INCOMPLETE_DAYS).
  const [incompleteInfo, setIncompleteInfo] = useState<Array<{ userId: number; date: string }> | null>(null);

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

  // Monatswechsel: veraltete Blockier-Liste verwerfen.
  useEffect(() => { setIncompleteInfo(null); }, [month]);

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

  // ---- Sammel-Monatsabschluss (ganze Firma) --------------------------------
  const canCloseAll = !!user && (user.isSuperAdmin || user.role === 'admin' || user.role === 'buchhaltung');
  const canReopenAll = !!user && (user.isSuperAdmin || user.role === 'admin');
  const anyClosed = rows.some((r) => r.closed);
  const nameByUserId = useMemo(() => {
    const m = new Map<number, string>();
    rows.forEach((r) => m.set(r.userId, nameOf(r)));
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // Firmen-Kontext für firmenweite Aktionen: Firmen-Admins nutzen implizit ihre
  // eigene Firma (Server leitet sie aus dem Token ab); Super-/Mandanten-Admins
  // brauchen die im Kopf-Wechsler gewählte Firma (localStorage 'tf-company-context').
  const resolveBulkCompanyId = (): { companyId?: number } | null => {
    if (user?.companyId) return {}; // eigene Firma — Server ergänzt sie selbst
    const cc = localStorage.getItem('tf-company-context') || '';
    if (cc.startsWith('company:')) {
      const id = Number(cc.slice(8));
      if (Number.isFinite(id)) return { companyId: id };
    }
    toast.error(t('manage.closeAllNeedCompany'));
    return null;
  };

  const closeAll = async () => {
    const body = resolveBulkCompanyId();
    if (!body) return;
    const ok = await confirm({
      title: t('manage.closeAllTitle'),
      message: t('manage.closeAllConfirm', { month: monthLabel, count: rows.length }),
    });
    if (!ok) return;
    try {
      setBulkBusy(true);
      setIncompleteInfo(null);
      await api.post('/time/close-month', { month, ...body });
      toast.success(t('manage.closeAllSuccess'));
      load();
    } catch (e: any) {
      const data = e.response?.data || {};
      if (data.error === 'INCOMPLETE_DAYS' || data.code === 'INCOMPLETE_DAYS') {
        const days = (data.days || []).filter((d: any) => d && d.date);
        setIncompleteInfo(days);
        toast.error(t('manage.closeAllIncomplete'));
      } else if (data.error === 'ALREADY_CLOSED' || data.code === 'ALREADY_CLOSED') {
        toast.error(data.message || t('manage.closeAllAlreadyClosed'));
      } else {
        toast.error(data.message || data.error || t('manage.closeMonthError'));
      }
    } finally {
      setBulkBusy(false);
    }
  };

  const reopenAll = async () => {
    const body = resolveBulkCompanyId();
    if (!body) return;
    const ok = await confirm({
      title: t('manage.reopenAllTitle'),
      message: t('manage.reopenAllConfirm', { month: monthLabel }),
      danger: true,
    });
    if (!ok) return;
    try {
      setBulkBusy(true);
      await api.post('/time/reopen-month', { month, ...body });
      toast.success(t('manage.reopenAllSuccess'));
      setIncompleteInfo(null);
      load();
    } catch (e: any) {
      const data = e.response?.data || {};
      toast.error(data.message || data.error || t('manage.reopenMonthError'));
    } finally {
      setBulkBusy(false);
    }
  };

  // Blockierende Tage je Mitarbeiter gruppieren (Namen aus der Übersicht mappen).
  const incompleteByUser = useMemo(() => {
    if (!incompleteInfo) return [];
    const m = new Map<number, string[]>();
    incompleteInfo.forEach((d) => {
      const list = m.get(d.userId) || [];
      list.push(d.date);
      m.set(d.userId, list);
    });
    return [...m.entries()].map(([userId, dates]) => ({
      userId,
      name: nameByUserId.get(userId) || `#${userId}`,
      dates,
    }));
  }, [incompleteInfo, nameByUserId]);

  const fmtShortDate = (d: string) =>
    new Date(`${d}T00:00:00`).toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });

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

      {/* Sammel-Aktionen: Monat für die ganze Firma abschließen / wieder öffnen */}
      {tab === 'overview' && !selected && !loading && rows.length > 0 && (canCloseAll || (canReopenAll && anyClosed)) && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          {canCloseAll && (
            <button
              type="button"
              onClick={closeAll}
              disabled={bulkBusy}
              className="btn-primary inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <LockClosedIcon className="h-4 w-4" /> {t('manage.closeAll')}
            </button>
          )}
          {canReopenAll && anyClosed && (
            <button
              type="button"
              onClick={reopenAll}
              disabled={bulkBusy}
              className="btn-secondary inline-flex items-center gap-1.5 disabled:opacity-50"
            >
              <LockOpenIcon className="h-4 w-4" /> {t('manage.reopenAll')}
            </button>
          )}
        </div>
      )}

      {/* Hinweis-Box: blockierende (unvollständige) Tage aus dem Firmen-Abschluss */}
      {tab === 'overview' && !selected && incompleteByUser.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-700 px-4 py-3 text-sm text-amber-900 dark:text-amber-200">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{t('manage.closeAllBlockedTitle')}</p>
            <button
              type="button"
              onClick={() => setIncompleteInfo(null)}
              className="text-amber-700 dark:text-amber-300 hover:text-amber-900"
              aria-label={t('manage.closeAllBlockedDismiss')}
              title={t('manage.closeAllBlockedDismiss')}
            >
              <XMarkIcon className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-0.5">{t('manage.closeAllBlockedText')}</p>
          <ul className="mt-2 space-y-0.5 list-disc list-inside">
            {incompleteByUser.map((u) => (
              <li key={u.userId}>
                <span className="font-medium">{u.name}</span>: {u.dates.map(fmtShortDate).join(', ')}
              </li>
            ))}
          </ul>
        </div>
      )}

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
