import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClockIcon,
  PlayIcon,
  StopIcon,
  PauseIcon,
  ScaleIcon,
  CalendarDaysIcon,
  MapPinIcon,
  NewspaperIcon,
  ArrowRightIcon,
  CheckCircleIcon,
} from '@heroicons/react/24/outline';
import toast from 'react-hot-toast';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useT, useI18n } from '../i18n';
import { formatMinutes, formatSignedMinutes, timeHHMM } from '../lib/timeFormat';
import { FeedCard, FeedItem } from './Feed';
import clsx from 'clsx';

type StampState = 'out' | 'in' | 'break';
type StampType = 'in' | 'out' | 'break_start' | 'break_end';
type BreakMode = 'auto' | 'manual' | 'combined';

interface WorkDayDto {
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

const KNOWN_ERROR_CODES = ['ALREADY_IN', 'NOT_IN', 'BREAK_OPEN', 'NO_BREAK', 'GPS_REQUIRED'];

/**
 * Kompakte „Neuestes aus dem Feed"-Card: Top 3 actionRequired-/high-Items
 * + Link zum vollständigen Feed.
 */
function FeedTeaser() {
  const t = useT();
  const [items, setItems] = useState<FeedItem[] | null>(null);

  useEffect(() => {
    let active = true;
    api.get('/feed')
      .then((r) => {
        if (!active) return;
        const all: FeedItem[] = r.data.items || [];
        setItems(all.filter((i) => i.actionRequired || i.priority === 'high').slice(0, 3));
      })
      .catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, []);

  if (items === null) return null; // still laden, kein Flackern

  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center">
          <NewspaperIcon className="h-6 w-6 text-primary-600 mr-3" />
          <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('feed.dashboardCard.title')}</h2>
        </div>
        <Link
          to="/feed"
          className="inline-flex items-center gap-1 text-sm font-medium text-primary-600 hover:text-primary-700 dark:text-primary-400"
        >
          {t('feed.dashboardCard.toFeed')} <ArrowRightIcon className="h-4 w-4" />
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="flex items-center gap-1.5 text-sm text-slate-500 dark:text-gray-400">
          <CheckCircleIcon className="h-5 w-5 text-green-500" /> {t('feed.dashboardCard.empty')}
        </p>
      ) : (
        <div className="space-y-3">
          {items.map((item) => <FeedCard key={item.id} item={item} compact />)}
        </div>
      )}
    </div>
  );
}

/** GPS best-effort holen: Timeout 3s, bei Ablehnung/Fehler null (kein Blocker). */
function getPosition(): Promise<GeolocationPosition | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve(pos),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 3000, maximumAge: 60000 }
    );
  });
}

/**
 * Dashboard = Stempeluhr: aktueller Stempel-Zustand, Kommen/Gehen/Pause-Buttons
 * (je nach Pausenmodus), Tageswerte und kumuliertes Zeitkonto.
 */
export default function Dashboard() {
  const { user } = useAuthStore();
  const t = useT();
  const { lang } = useI18n();
  const [now, setNow] = useState(() => new Date());

  const [state, setState] = useState<StampState>('out');
  const [since, setSince] = useState<Date | null>(null);
  const [today, setToday] = useState<WorkDayDto | null>(null);
  const [breakMode, setBreakMode] = useState<BreakMode>('manual');
  // GPS-Modus der Firma: bei 'off' wird gar kein Standort abgefragt (kein Popup).
  const [gpsMode, setGpsMode] = useState<string>('optional');
  const [balanceMinutes, setBalanceMinutes] = useState<number | null>(null);
  const [balanceUpTo, setBalanceUpTo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [stamping, setStamping] = useState<StampType | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  /** Status-Antwort tolerant lesen (Server liefert state als Objekt {state, since, …}). */
  const applyStatus = useCallback((data: any) => {
    const st = data?.state && typeof data.state === 'object' ? data.state : data || {};
    const nextState: StampState = st.state === 'in' || st.state === 'break' ? st.state : 'out';
    setState(nextState);
    setSince(st.since ? new Date(st.since) : null);
    const day = data?.workDay ?? data?.today ?? null;
    setToday(day);
    if (data?.breakMode === 'auto' || data?.breakMode === 'manual' || data?.breakMode === 'combined') {
      setBreakMode(data.breakMode);
    }
    if (typeof data?.gpsMode === 'string') setGpsMode(data.gpsMode);
    if (typeof data?.balanceMinutes === 'number') setBalanceMinutes(data.balanceMinutes);
  }, []);

  const load = useCallback(async () => {
    try {
      const [statusRes, balanceRes] = await Promise.all([
        api.get('/time/status'),
        api.get('/time/balance').catch(() => null),
      ]);
      applyStatus(statusRes.data);
      if (balanceRes && typeof balanceRes.data?.balanceMinutes === 'number') {
        setBalanceMinutes(balanceRes.data.balanceMinutes);
        setBalanceUpTo(balanceRes.data.upToDate || null);
      }
      // breakMode kommt idealerweise aus /time/status; sonst (nur Admin) aus den
      // Einstellungen — Nicht-Admins behalten den Default 'manual' (Pause-Buttons sichtbar).
      if (statusRes.data?.breakMode == null && user?.role === 'admin') {
        try {
          const s = await api.get('/settings');
          if (s.data?.breakMode) setBreakMode(s.data.breakMode);
        } catch { /* ignore */ }
      }
    } catch (error) {
      console.error('Error loading time status:', error);
      toast.error(t('time.statusLoadError'));
    } finally {
      setLoading(false);
    }
  }, [applyStatus, t, user?.role]);

  useEffect(() => { load(); }, [load]);

  const stamp = async (type: StampType) => {
    if (stamping) return;
    setStamping(type);
    try {
      const pos = gpsMode === 'off' ? null : await getPosition();
      const body: Record<string, unknown> = { type };
      if (pos) {
        body.lat = pos.coords.latitude;
        body.lng = pos.coords.longitude;
        body.accuracy = pos.coords.accuracy;
      }
      const res = await api.post('/time/stamp', body);
      applyStatus(res.data);
      const successKey =
        type === 'in' ? 'time.stampedIn' :
        type === 'out' ? 'time.stampedOut' :
        type === 'break_start' ? 'time.breakStarted' : 'time.breakEnded';
      toast.success(t(successKey));
      if (!pos) {
        // Dezenter Hinweis: gestempelt, aber ohne Standort (kein Fehler).
        toast(t('time.noGpsHint'), { icon: '📍' });
      }
      // Tageswerte ggf. nachladen, falls die Stamp-Antwort keinen WorkDay enthielt.
      if (!res.data?.workDay && !res.data?.today) load();
    } catch (error: any) {
      const data = error?.response?.data;
      const code: string = data?.code || data?.error || '';
      if (KNOWN_ERROR_CODES.includes(code)) {
        toast.error(t(`time.errors.${code}`));
        // Zustand war offenbar veraltet → neu laden.
        load();
      } else {
        toast.error(data?.message || data?.error || t('time.stampError'));
      }
    } finally {
      setStamping(null);
    }
  };

  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const timeString = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const dateString = now.toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  const sinceLabel = since ? timeHHMM(since, locale) : '';
  const stateLabel =
    state === 'in' ? t('time.stateIn', { time: sinceLabel }) :
    state === 'break' ? t('time.stateBreak', { time: sinceLabel }) :
    t('time.stateOut');

  const showBreakButtons = breakMode === 'manual' || breakMode === 'combined';
  const totalBreak = (today?.breakMinutes ?? 0) + (today?.autoBreakMinutes ?? 0);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Begrüßung */}
      <div className="card">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          {t('dashboard.welcomeBack', { name: `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() })}
        </h1>
        <p className="mt-1 text-slate-600 dark:text-gray-400">{t('dashboard.subtitle')}</p>
      </div>

      {/* Stempeluhr: Live-Uhr + Zustand + Aktionen */}
      <div className="card text-center py-8 sm:py-10">
        <p className="text-sm font-medium uppercase tracking-wide text-slate-500 dark:text-gray-400">{t('time.clockTitle')}</p>
        <div className="mt-3 text-5xl sm:text-6xl font-bold tabular-nums tracking-tight text-slate-900 dark:text-white">
          {timeString}
        </div>
        <p className="mt-2 text-lg text-slate-600 dark:text-gray-400">{dateString}</p>

        <div className="mt-5 flex items-center justify-center gap-2">
          <span
            className={clsx(
              'inline-block h-3 w-3 rounded-full',
              state === 'in' && 'bg-green-500 animate-pulse',
              state === 'break' && 'bg-amber-500 animate-pulse',
              state === 'out' && 'bg-slate-400'
            )}
            aria-hidden="true"
          />
          <span className="text-base sm:text-lg font-semibold text-slate-800 dark:text-gray-200">{stateLabel}</span>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 px-4">
          {loading ? (
            <div className="h-14 w-full sm:w-56 rounded-xl bg-gray-200 dark:bg-gray-700 animate-pulse" />
          ) : (
            <>
              {state === 'out' && (
                <button
                  type="button"
                  onClick={() => stamp('in')}
                  disabled={!!stamping}
                  className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-lg font-semibold shadow-md transition-colors"
                >
                  <PlayIcon className="h-6 w-6" /> {t('time.clockIn')}
                </button>
              )}
              {state === 'in' && (
                <>
                  <button
                    type="button"
                    onClick={() => stamp('out')}
                    disabled={!!stamping}
                    className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-lg font-semibold shadow-md transition-colors"
                  >
                    <StopIcon className="h-6 w-6" /> {t('time.clockOut')}
                  </button>
                  {showBreakButtons && (
                    <button
                      type="button"
                      onClick={() => stamp('break_start')}
                      disabled={!!stamping}
                      className="flex items-center justify-center gap-2 px-6 py-4 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-white text-lg font-semibold shadow-md transition-colors"
                    >
                      <PauseIcon className="h-6 w-6" /> {t('time.breakStart')}
                    </button>
                  )}
                </>
              )}
              {state === 'break' && (
                <button
                  type="button"
                  onClick={() => stamp('break_end')}
                  disabled={!!stamping}
                  className="flex items-center justify-center gap-2 px-8 py-4 rounded-xl bg-primary-600 hover:bg-primary-700 disabled:opacity-60 text-white text-lg font-semibold shadow-md transition-colors"
                >
                  <PlayIcon className="h-6 w-6" /> {t('time.breakEnd')}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Neuestes aus dem Feed (Top-Aufgaben/Warnungen) */}
      <FeedTeaser />

      {/* Tages- und Saldo-Karten */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex items-center mb-4">
            <CalendarDaysIcon className="h-6 w-6 text-primary-600 mr-3" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('time.todayTitle')}</h2>
          </div>
          {today ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-500 dark:text-gray-400">{t('time.worked')}</p>
                <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{formatMinutes(today.workedMinutes)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-gray-400">{t('time.breakLabel')}</p>
                <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{formatMinutes(totalBreak)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-gray-400">{t('time.target')}</p>
                <p className="text-xl font-bold tabular-nums text-slate-900 dark:text-white">{formatMinutes(today.targetMinutes)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-gray-400">{t('time.balance')}</p>
                <p className={clsx(
                  'text-xl font-bold tabular-nums',
                  today.balanceMinutes < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
                )}>
                  {formatSignedMinutes(today.balanceMinutes)}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-start gap-2 text-sm text-slate-600 dark:text-gray-400">
              <ClockIcon className="h-5 w-5 text-primary-500 flex-shrink-0 mt-0.5" />
              <p>{t('time.noWorkDay')}</p>
            </div>
          )}
          {today?.flags?.includes('no_gps') && (
            <p className="mt-3 flex items-center gap-1.5 text-xs text-slate-500 dark:text-gray-400">
              <MapPinIcon className="h-4 w-4" /> {t('time.flags.no_gps')}
            </p>
          )}
        </div>

        <div className="card">
          <div className="flex items-center mb-4">
            <ScaleIcon className="h-6 w-6 text-primary-600 mr-3" />
            <h2 className="text-lg font-semibold text-slate-900 dark:text-white">{t('time.balanceTitle')}</h2>
          </div>
          <p className={clsx(
            'text-3xl font-bold tabular-nums',
            (balanceMinutes ?? 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'
          )}>
            {balanceMinutes == null ? '–' : formatSignedMinutes(balanceMinutes)}
          </p>
          <p className="mt-2 text-sm text-slate-500 dark:text-gray-400">{t('time.balanceHint')}</p>
          {balanceUpTo && (
            <p className="mt-1 text-xs text-slate-400 dark:text-gray-500">
              {t('time.balanceUpTo', { date: new Date(`${balanceUpTo}T00:00:00`).toLocaleDateString(locale) })}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
