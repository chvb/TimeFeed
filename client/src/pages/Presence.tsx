import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { UserGroupIcon } from '@heroicons/react/24/outline';
import clsx from 'clsx';
import api from '../lib/api';
import ErrorBanner from '../components/ErrorBanner';
import SearchInput from '../components/common/SearchInput';
import { useT, useI18n } from '../i18n';

type PresenceState = 'in' | 'break' | 'out';

interface PresenceRow {
  userId: number;
  firstName?: string;
  lastName?: string;
  groupName?: string | null;
  state: PresenceState;
  since?: string | null;
}

const REFRESH_MS = 30_000;

/** Server-Status defensiv normalisieren ('in'/'present' → in, 'break' → break, sonst out). */
function normalizeState(raw: any): PresenceState {
  const s = String(raw || '').toLowerCase();
  if (s === 'in' || s === 'present') return 'in';
  if (s === 'break' || s === 'pause') return 'break';
  return 'out';
}

const DOT: Record<PresenceState, string> = {
  in: 'bg-green-500',
  break: 'bg-amber-400',
  out: 'bg-slate-300 dark:bg-gray-600',
};

/** Anwesenheitstafel: Karten-Grid mit Live-Status aller erreichbaren Mitarbeiter. */
export default function Presence() {
  const t = useT();
  const { lang } = useI18n();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const [rows, setRows] = useState<PresenceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [search, setSearch] = useState('');
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const timerRef = useRef<number | null>(null);

  const loadSeq = useRef(0);
  const load = useCallback(async (silent = false) => {
    const myId = ++loadSeq.current;
    try {
      if (!silent) setLoading(true);
      const r = await api.get('/time/presence');
      if (loadSeq.current !== myId) return; // veraltete Antwort verwerfen
      // Server-Contract: Antwort ist ein Array [{ userId, firstName, lastName, groupName, state, since }]
      const list: any[] = Array.isArray(r.data) ? r.data : (r.data.presence || r.data.users || []);
      setRows(list.map((p) => ({
        userId: p.userId ?? p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        groupName: p.groupName ?? p.group?.name ?? null,
        state: normalizeState(p.state ?? p.status),
        since: p.since ?? null,
      })));
      setUpdatedAt(new Date());
      setLoadError('');
    } catch {
      if (loadSeq.current !== myId) return;
      if (!silent) setLoadError(t('presence.loadError'));
    } finally {
      if (loadSeq.current === myId && !silent) setLoading(false);
    }
  }, [t]);

  // Initial laden + Auto-Refresh alle 30 s (still, ohne Lade-Flackern).
  useEffect(() => {
    load();
    timerRef.current = window.setInterval(() => load(true), REFRESH_MS);
    return () => { if (timerRef.current) window.clearInterval(timerRef.current); };
  }, [load]);

  const nameOf = (r: PresenceRow) => `${r.firstName || ''} ${r.lastName || ''}`.trim() || `#${r.userId}`;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => nameOf(r).toLowerCase().includes(q) || (r.groupName || '').toLowerCase().includes(q));
  }, [rows, search]);

  const counts = useMemo(() => rows.reduce(
    (acc, r) => { acc[r.state] += 1; return acc; },
    { in: 0, break: 0, out: 0 } as Record<PresenceState, number>
  ), [rows]);

  const sinceText = (r: PresenceRow) => {
    if (!r.since) return '';
    const d = new Date(r.since);
    if (isNaN(d.getTime())) return '';
    return t('presence.since', { time: d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' }) });
  };

  const stateLabel: Record<PresenceState, string> = {
    in: t('presence.present'),
    break: t('presence.onBreak'),
    out: t('presence.absent'),
  };

  return (
    <div>
      <ErrorBanner message={loadError} onRetry={() => load()} />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <h1 className="text-3xl font-bold text-slate-900 dark:text-white">{t('presence.title')}</h1>
        <SearchInput value={search} onChange={setSearch} placeholder={t('presence.searchPlaceholder')} className="sm:w-72" />
      </div>

      {/* Zusammenfassung */}
      <div className="card mb-4">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-gray-300">
            <span className="h-3 w-3 rounded-full bg-green-500 inline-block" />
            <span className="font-semibold tabular-nums">{counts.in}</span> {t('presence.present')}
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-gray-300">
            <span className="h-3 w-3 rounded-full bg-amber-400 inline-block" />
            <span className="font-semibold tabular-nums">{counts.break}</span> {t('presence.onBreak')}
          </span>
          <span className="inline-flex items-center gap-2 text-sm text-slate-700 dark:text-gray-300">
            <span className="h-3 w-3 rounded-full bg-slate-300 dark:bg-gray-600 inline-block" />
            <span className="font-semibold tabular-nums">{counts.out}</span> {t('presence.absent')}
          </span>
          <span className="ml-auto text-xs text-slate-400" title={t('presence.autoRefresh')}>
            {updatedAt ? t('presence.lastUpdated', { time: updatedAt.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }) : ''}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="card animate-pulse h-20" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <UserGroupIcon className="mx-auto h-12 w-12 text-slate-400 mb-4" />
          <p className="text-slate-600 dark:text-gray-400">{t('presence.empty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map((r) => (
            <div key={r.userId} className="card flex items-center gap-3">
              <span className={clsx('h-3.5 w-3.5 rounded-full inline-block flex-shrink-0', DOT[r.state])} title={stateLabel[r.state]} />
              <div className="min-w-0">
                <p className="font-medium text-slate-900 dark:text-gray-100 truncate">{nameOf(r)}</p>
                <p className="text-xs text-slate-500 dark:text-gray-400 truncate">
                  {r.groupName || '–'}
                </p>
                <p className="text-xs text-slate-500 dark:text-gray-400">
                  {stateLabel[r.state]}{sinceText(r) ? ` · ${sinceText(r)}` : ''}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
