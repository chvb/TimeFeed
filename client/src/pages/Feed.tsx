import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowPathIcon,
  ArrowRightStartOnRectangleIcon,
  BuildingOfficeIcon,
  CakeIcon,
  CalendarDaysIcon,
  ChartBarIcon,
  ClockIcon,
  DeviceTabletIcon,
  DocumentArrowUpIcon,
  ExclamationTriangleIcon,
  LockClosedIcon,
  MapPinIcon,
  NewspaperIcon,
  PencilSquareIcon,
  ScaleIcon,
  ServerStackIcon,
  StarIcon,
  UserGroupIcon,
  UserPlusIcon,
} from '@heroicons/react/24/outline';
import api from '../lib/api';
import { useAuthStore } from '../store/authStore';
import { useT, useI18n } from '../i18n';
import { formatMinutes, formatSignedMinutes, timeHHMM } from '../lib/timeFormat';
import ErrorBanner from '../components/ErrorBanner';
import clsx from 'clsx';

type TFunc = (key: string, vars?: Record<string, string | number>) => string;

export interface FeedItem {
  id: string;
  type: string;
  priority: 'high' | 'normal' | 'low';
  actionRequired: boolean;
  timestamp: string;
  data: Record<string, any>;
  link?: string;
}

type Tab = 'all' | 'tasks' | 'company' | 'team' | 'personal';

// Persönliche Item-Typen (Chip „Persönlich"); 'absence'/'birthday_upcoming'
// zählen nur mit data.self.
const PERSONAL_TYPES = new Set([
  'stamp_status', 'balance', 'correction_own_pending', 'correction_own_decided', 'day_warning',
  'my_week_summary', 'my_month_summary',
]);

// Unternehmens-Ebene (Chip „Unternehmen", nur Verwalter-Rollen): Digest-Karten
// mit Mini-Kennzahlen. Bestehende Typen bleiben bewusst im Chip „Team".
const COMPANY_TYPES = new Set([
  'company_week_digest', 'month_progress', 'balance_outlier', 'absence_rate_today',
  'auto_capped_last_night', 'backup_status', 'upcoming_exit', 'gps_missing',
]);

const isPersonal = (item: FeedItem): boolean =>
  PERSONAL_TYPES.has(item.type)
  || (item.type === 'absence' && !!item.data.self)
  || (item.type === 'birthday_upcoming' && !!item.data.self);

const isCompany = (item: FeedItem): boolean => COMPANY_TYPES.has(item.type);

/** Lokales YYYY-MM-DD. */
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(value: string | null | undefined, locale: string): string {
  if (!value) return '–';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (isNaN(d.getTime())) return '–';
  return d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/** 'YYYY-MM' als lokalisierten Monatsnamen (z. B. „Juni 2026") formatieren. */
function fmtMonth(monthKey: string | null | undefined, locale: string): string {
  if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) return monthKey || '–';
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' });
}

/** Abwesenheits-Label: bekannte Keys via i18n, unbekannte roh anzeigen. */
function absenceLabel(kind: string, t: TFunc): string {
  const key = `time.absence.${kind}`;
  const label = t(key);
  return label !== key ? label : kind;
}

/** Titel + Beschreibung eines Items rein CLIENTSEITIG aus type + Rohdaten übersetzen. */
export function feedItemText(item: FeedItem, t: TFunc, locale: string): { title: string; desc: string } {
  const d = item.data || {};
  switch (item.type) {
    case 'stamp_status': {
      const title = t(`feed.item.stamp_status.title_${d.state === 'in' ? 'in' : d.state === 'break' ? 'break' : 'out'}`)
        + (d.since && d.state !== 'out' ? ` (${t('feed.item.stamp_status.since', { time: timeHHMM(d.since, locale) })})` : '');
      return { title, desc: t('feed.item.stamp_status.desc', { worked: formatMinutes(d.workedMinutes || 0), target: formatMinutes(d.targetMinutes || 0) }) };
    }
    case 'balance':
      return {
        title: t('feed.item.balance.title', { balance: formatSignedMinutes(d.balanceMinutes || 0) }),
        desc: t('feed.item.balance.desc', { date: fmtDate(d.upToDate, locale) }),
      };
    case 'correction_own_pending':
      return {
        title: t('feed.item.correction_own_pending.title', { date: fmtDate(d.date, locale) }),
        desc: t('feed.item.correction_own_pending.desc'),
      };
    case 'correction_own_decided':
      return {
        title: t(`feed.item.correction_own_decided.title_${d.status === 'approved' ? 'approved' : 'rejected'}`, { date: fmtDate(d.date, locale) }),
        desc: d.decisionNote ? t('feed.item.correction_own_decided.descNote', { note: d.decisionNote }) : '',
      };
    case 'day_warning':
      return {
        title: t(`feed.item.day_warning.title_${d.reason === 'auto_capped' ? 'auto_capped' : 'incomplete'}`),
        desc: t('feed.item.day_warning.desc', { date: fmtDate(d.date, locale) }),
      };
    case 'presence_summary':
      return {
        title: t('feed.item.presence_summary.title', { present: d.present ?? 0, onBreak: d.onBreak ?? 0, absent: d.absent ?? 0 }),
        desc: t('feed.item.presence_summary.desc', { total: d.total ?? 0 }),
      };
    case 'stamp_event':
      return {
        title: t(`feed.item.stamp_event.title_${d.stampType === 'in' ? 'in' : 'out'}`, { name: d.name }),
        desc: t('feed.item.stamp_event.desc', { time: timeHHMM(item.timestamp, locale), source: t(`feed.source.${d.source}`) !== `feed.source.${d.source}` ? t(`feed.source.${d.source}`) : d.source }),
      };
    case 'missing_out':
      return {
        title: t('feed.item.missing_out.title', { name: d.name }),
        desc: t('feed.item.missing_out.desc', { date: fmtDate(d.date, locale) }),
      };
    case 'correction_open':
      return {
        title: t('feed.item.correction_open.title', { name: d.name }),
        desc: t('feed.item.correction_open.desc', { date: fmtDate(d.date, locale), message: d.message || '' }),
      };
    case 'arbzg_violation': {
      const flags = (Array.isArray(d.flags) ? d.flags : [])
        .map((f: string) => t(`feed.item.arbzg_violation.flag_${f}`))
        .join(', ');
      return {
        title: t('feed.item.arbzg_violation.title', { name: d.name }),
        desc: t('feed.item.arbzg_violation.desc', { date: fmtDate(d.date, locale), flags }),
      };
    }
    case 'terminal_issue': {
      const title = t(`feed.item.terminal_issue.title_${d.reason === 'inactive' ? 'inactive' : 'stale'}`, { name: d.name });
      const seen = d.lastSeenAt
        ? t('feed.item.terminal_issue.descSeen', { time: `${fmtDate(d.lastSeenAt, locale)} ${timeHHMM(d.lastSeenAt, locale)}` })
        : t('feed.item.terminal_issue.descNever');
      const loc = d.location ? ` · ${t('feed.item.terminal_issue.location', { location: d.location })}` : '';
      return { title, desc: seen + loc };
    }
    case 'timesheet_upload':
      return {
        title: t('feed.item.timesheet_upload.title', { name: d.name }),
        desc: t('feed.item.timesheet_upload.desc', { fileName: d.fileName, start: fmtDate(d.periodStart, locale), end: fmtDate(d.periodEnd, locale) }),
      };
    case 'month_open':
      return {
        title: t('feed.item.month_open.title', { month: d.month }),
        desc: t('feed.item.month_open.desc', { company: d.companyName || '' }),
      };
    case 'sync_result':
      return d.ok
        ? { title: t('feed.item.sync_result.title_ok'), desc: t('feed.item.sync_result.desc_ok', { set: d.daysSet ?? 0, cleared: d.daysCleared ?? 0 }) }
        : { title: t('feed.item.sync_result.title_error'), desc: t('feed.item.sync_result.desc_error', { error: d.error || '' }) };
    case 'absence': {
      const label = absenceLabel(d.absence, t);
      return {
        title: d.self ? t('feed.item.absence.title_self', { label }) : t('feed.item.absence.title_other', { name: d.name, label }),
        desc: d.startDate === d.endDate
          ? t('feed.item.absence.descDay', { start: fmtDate(d.startDate, locale) })
          : t('feed.item.absence.descRange', { start: fmtDate(d.startDate, locale), end: fmtDate(d.endDate, locale) }),
      };
    }
    case 'holiday':
      return {
        title: t('feed.item.holiday.title', { name: d.name }) + (d.holidayType === 'company' ? ` (${t('feed.item.holiday.company')})` : ''),
        desc: t('feed.item.holiday.desc', { date: fmtDate(d.startDate, locale) }),
      };
    case 'anniversary':
      return {
        title: t(d.years === 1 ? 'feed.item.anniversary.title_one' : 'feed.item.anniversary.title_many', { name: d.name, years: d.years }),
        desc: t('feed.item.anniversary.desc', { date: fmtDate(d.date, locale) }),
      };
    case 'new_colleague':
      return {
        title: t('feed.item.new_colleague.title', { name: d.name }),
        desc: t('feed.item.new_colleague.desc', { date: fmtDate(d.date, locale) }),
      };
    case 'my_week_summary':
      return {
        title: t('feed.item.my_week_summary.title', { balance: formatSignedMinutes(d.balanceMinutes || 0) }),
        desc: t('feed.item.my_week_summary.desc', { start: fmtDate(d.weekStart, locale) }),
      };
    case 'my_month_summary':
      return {
        title: t('feed.item.my_month_summary.title', { month: fmtMonth(d.month, locale) }),
        desc: t(d.closed ? 'feed.item.my_month_summary.desc_closed' : 'feed.item.my_month_summary.desc_open'),
      };
    case 'company_week_digest':
      return {
        title: t('feed.item.company_week_digest.title'),
        desc: t('feed.item.company_week_digest.desc', { start: fmtDate(d.weekStart, locale), count: d.employeeCount ?? 0 }),
      };
    case 'month_progress': {
      const done = (d.closed ?? 0) >= (d.total ?? 0);
      return {
        title: t('feed.item.month_progress.title', { month: fmtMonth(d.month, locale) }),
        desc: done
          ? t('feed.item.month_progress.desc_done', { total: d.total ?? 0 })
          : t('feed.item.month_progress.desc', { closed: d.closed ?? 0, total: d.total ?? 0 }),
      };
    }
    case 'balance_outlier':
      return {
        title: t(`feed.item.balance_outlier.title_${d.direction === 'over' ? 'over' : 'under'}`, {
          threshold: formatSignedMinutes(d.thresholdMinutes || 0),
        }),
        desc: t((d.count ?? 0) === 1 ? 'feed.item.balance_outlier.desc_one' : 'feed.item.balance_outlier.desc', { count: d.count ?? 0 }),
      };
    case 'absence_rate_today':
      return {
        title: t('feed.item.absence_rate_today.title', { absent: d.absent ?? 0, total: d.total ?? 0 }),
        desc: t('feed.item.absence_rate_today.desc'),
      };
    case 'auto_capped_last_night': {
      const names = (Array.isArray(d.names) ? d.names : []).join(', ')
        + ((d.moreCount ?? 0) > 0 ? ' ' + t('feed.item.auto_capped_last_night.more', { count: d.moreCount }) : '');
      return {
        title: t((d.count ?? 0) === 1 ? 'feed.item.auto_capped_last_night.title_one' : 'feed.item.auto_capped_last_night.title', { count: d.count ?? 0 }),
        desc: t('feed.item.auto_capped_last_night.desc', { date: fmtDate(d.date, locale), names }),
      };
    }
    case 'gps_missing':
      return {
        title: t('feed.item.gps_missing.title'),
        desc: t((d.count ?? 0) === 1 ? 'feed.item.gps_missing.desc_one' : 'feed.item.gps_missing.desc', { count: d.count ?? 0 }),
      };
    case 'backup_status':
      return d.reason === 'never'
        ? { title: t('feed.item.backup_status.title_never'), desc: t('feed.item.backup_status.desc_never') }
        : {
          title: t('feed.item.backup_status.title_stale', { days: d.ageDays ?? 0 }),
          desc: t('feed.item.backup_status.desc_stale', { date: fmtDate(d.lastBackupAt, locale) }),
        };
    case 'upcoming_exit':
      return {
        title: t('feed.item.upcoming_exit.title', { name: d.name }),
        desc: t('feed.item.upcoming_exit.desc', { date: fmtDate(d.date, locale) }),
      };
    case 'birthday_upcoming':
      return {
        title: d.self ? t('feed.item.birthday_upcoming.title_self') : t('feed.item.birthday_upcoming.title_other', { name: d.name }),
        desc: t('feed.item.birthday_upcoming.desc', { date: fmtDate(d.date, locale) }),
      };
    default:
      return { title: item.type, desc: '' };
  }
}

// ---------------------------------------------------------------------------
// Digest-Optik: kleine Kennzahlen-Zeilen / Fortschrittsbalken / Namenslisten
// in der Karte (Unternehmens- und persönliche Zusammenfassungs-Items).
// ---------------------------------------------------------------------------

interface FeedExtras {
  /** Zweispaltige Mini-Kennzahlen (Label + Wert). */
  stats?: Array<{ label: string; value: string; accent?: string }>;
  /** Fortschrittsbalken-Rohdaten (month_progress). */
  progress?: { value: number; total: number };
  /** Zeilen „Name — Wert" (balance_outlier, gps_missing). */
  rows?: Array<{ label: string; value: string; accent?: string }>;
  /** Fußnote (z. B. „+ 3 weitere"). */
  note?: string;
}

const signedAccent = (min: number): string =>
  min < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400';

/** Zusatz-Kennzahlen eines Items (null = normale Karte ohne Digest-Optik). */
export function feedItemExtras(item: FeedItem, t: TFunc, locale: string): FeedExtras | null {
  const d = item.data || {};
  switch (item.type) {
    case 'my_week_summary':
      return {
        stats: [
          { label: t('feed.item.my_week_summary.statWorked'), value: formatMinutes(d.workedMinutes || 0) },
          { label: t('feed.item.my_week_summary.statTarget'), value: formatMinutes(d.targetMinutes || 0) },
          { label: t('feed.item.my_week_summary.statBalance'), value: formatSignedMinutes(d.balanceMinutes || 0), accent: signedAccent(d.balanceMinutes || 0) },
        ],
      };
    case 'my_month_summary':
      return {
        stats: [
          { label: t('feed.item.my_month_summary.statWorked'), value: formatMinutes(d.workedMinutes || 0) },
          { label: t('feed.item.my_month_summary.statTarget'), value: formatMinutes(d.targetMinutes || 0) },
          { label: t('feed.item.my_month_summary.statBalance'), value: formatSignedMinutes(d.balanceMinutes || 0), accent: signedAccent(d.balanceMinutes || 0) },
        ],
      };
    case 'company_week_digest':
      return {
        stats: [
          { label: t('feed.item.company_week_digest.statWorked'), value: formatMinutes(d.workedMinutes || 0) },
          { label: t('feed.item.company_week_digest.statTarget'), value: formatMinutes(d.targetMinutes || 0) },
          {
            label: t('feed.item.company_week_digest.statBehind'),
            value: String(d.behindCount ?? 0),
            accent: (d.behindCount ?? 0) > 0 ? 'text-amber-600 dark:text-amber-400' : undefined,
          },
          { label: t('feed.item.company_week_digest.statAvg'), value: formatSignedMinutes(d.avgBalanceMinutes || 0), accent: signedAccent(d.avgBalanceMinutes || 0) },
        ],
      };
    case 'month_progress':
      return { progress: { value: d.closed ?? 0, total: d.total ?? 0 } };
    case 'balance_outlier':
      return {
        rows: (Array.isArray(d.entries) ? d.entries : []).map((e: any) => ({
          label: e.name,
          value: formatSignedMinutes(e.balanceMinutes || 0),
          accent: signedAccent(e.balanceMinutes || 0),
        })),
        note: (d.moreCount ?? 0) > 0 ? t('feed.item.balance_outlier.more', { count: d.moreCount }) : undefined,
      };
    case 'gps_missing':
      return {
        rows: (Array.isArray(d.entries) ? d.entries : []).map((e: any) => ({
          label: e.name,
          value: fmtDate(e.date, locale),
        })),
        note: (d.moreCount ?? 0) > 0 ? t('feed.item.gps_missing.more', { count: d.moreCount }) : undefined,
      };
    case 'absence_rate_today': {
      const byKind = d.byKind && typeof d.byKind === 'object' ? d.byKind : {};
      const stats = Object.entries(byKind).map(([kind, count]) => ({
        label: absenceLabel(kind, t),
        value: String(count),
      }));
      return stats.length > 0 ? { stats } : null;
    }
    default:
      return null;
  }
}

// Icon-Badge je Item-Typ. Vollständige statische Klassen (Tailwind-Purge!).
export function feedItemIcon(item: FeedItem) {
  const d = item.data || {};
  const badge = (Icon: any, cls: string) => (
    <span className={clsx('flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full', cls)}>
      <Icon className="h-5 w-5" />
    </span>
  );
  switch (item.type) {
    case 'stamp_status':
      return d.state === 'out'
        ? badge(ClockIcon, 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400')
        : badge(ClockIcon, 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400');
    case 'stamp_event':
      return d.stampType === 'in'
        ? badge(ClockIcon, 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400')
        : badge(ClockIcon, 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400');
    case 'balance':
      return badge(ScaleIcon, 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400');
    case 'day_warning':
    case 'arbzg_violation':
    case 'missing_out':
      return badge(ExclamationTriangleIcon, 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400');
    case 'correction_own_pending':
    case 'correction_own_decided':
    case 'correction_open':
      return badge(PencilSquareIcon, 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400');
    case 'month_open':
      return badge(LockClosedIcon, 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400');
    case 'presence_summary':
      return badge(UserGroupIcon, 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400');
    case 'terminal_issue':
      return badge(DeviceTabletIcon, 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400');
    case 'timesheet_upload':
      return badge(DocumentArrowUpIcon, 'bg-slate-100 text-slate-600 dark:bg-gray-700 dark:text-gray-300');
    case 'sync_result':
      return d.ok
        ? badge(ArrowPathIcon, 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400')
        : badge(ArrowPathIcon, 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400');
    case 'absence':
      // AbsenceBadge-Farben: Urlaub blau, Krank violett, sonst primary.
      return d.absence === 'sick'
        ? badge(CalendarDaysIcon, 'bg-violet-100 text-violet-600 dark:bg-violet-900/40 dark:text-violet-400')
        : d.absence === 'vacation'
          ? badge(CalendarDaysIcon, 'bg-blue-100 text-blue-600 dark:bg-blue-900/40 dark:text-blue-400')
          : badge(CalendarDaysIcon, 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400');
    case 'holiday':
      return badge(CalendarDaysIcon, 'bg-green-100 text-green-600 dark:bg-green-900/40 dark:text-green-400');
    case 'anniversary':
      return badge(StarIcon, 'bg-yellow-100 text-yellow-600 dark:bg-yellow-900/40 dark:text-yellow-400');
    case 'new_colleague':
      return badge(UserPlusIcon, 'bg-pink-100 text-pink-600 dark:bg-pink-900/40 dark:text-pink-400');
    case 'my_week_summary':
    case 'my_month_summary':
      return badge(ChartBarIcon, 'bg-primary-100 text-primary-600 dark:bg-primary-900/40 dark:text-primary-400');
    case 'company_week_digest':
      return badge(BuildingOfficeIcon, 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400');
    case 'month_progress':
      return badge(ChartBarIcon, 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/40 dark:text-indigo-400');
    case 'balance_outlier':
      return badge(ScaleIcon, 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400');
    case 'absence_rate_today':
      return badge(UserGroupIcon, 'bg-cyan-100 text-cyan-600 dark:bg-cyan-900/40 dark:text-cyan-400');
    case 'auto_capped_last_night':
      return badge(ExclamationTriangleIcon, 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400');
    case 'gps_missing':
      return badge(MapPinIcon, 'bg-amber-100 text-amber-600 dark:bg-amber-900/40 dark:text-amber-400');
    case 'backup_status':
      return badge(ServerStackIcon, 'bg-red-100 text-red-600 dark:bg-red-900/40 dark:text-red-400');
    case 'upcoming_exit':
      return badge(ArrowRightStartOnRectangleIcon, 'bg-orange-100 text-orange-600 dark:bg-orange-900/40 dark:text-orange-400');
    case 'birthday_upcoming':
      return badge(CakeIcon, 'bg-pink-100 text-pink-600 dark:bg-pink-900/40 dark:text-pink-400');
    default:
      return badge(NewspaperIcon, 'bg-slate-100 text-slate-600 dark:bg-gray-700 dark:text-gray-300');
  }
}

/** Eine Feed-Karte (auch vom Dashboard-Widget genutzt). */
export function FeedCard({ item, compact = false }: { item: FeedItem; compact?: boolean }) {
  const t = useT();
  const { lang } = useI18n();
  const navigate = useNavigate();
  const locale = lang === 'en' ? 'en-GB' : 'de-DE';
  const { title, desc } = feedItemText(item, t, locale);
  const extras = feedItemExtras(item, t, locale);
  const progressPct = extras?.progress && extras.progress.total > 0
    ? Math.round((extras.progress.value / extras.progress.total) * 100)
    : 0;
  const ts = new Date(item.timestamp);
  const timeLabel = ymd(ts) === ymd(new Date())
    ? timeHHMM(ts, locale)
    : ts.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });

  return (
    <div
      className={clsx(
        'card flex items-start gap-3',
        compact ? 'py-3' : 'py-4',
        item.priority === 'high' && 'border-l-4',
        item.priority === 'high' && (item.actionRequired ? 'border-l-red-500' : 'border-l-amber-500'),
      )}
    >
      {feedItemIcon(item)}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-sm font-semibold text-slate-900 dark:text-white break-words">
            {title}
            {item.actionRequired && (
              <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/40 dark:text-red-300">
                {t('feed.actionBadge')}
              </span>
            )}
          </p>
          <span className="flex-shrink-0 text-xs tabular-nums text-slate-400 dark:text-gray-500">{timeLabel}</span>
        </div>
        {desc && <p className="mt-0.5 text-sm text-slate-600 dark:text-gray-400 break-words">{desc}</p>}

        {/* Digest-Optik: zweispaltige Mini-Kennzahlen */}
        {extras?.stats && extras.stats.length > 0 && (
          <dl className="mt-2 grid max-w-md grid-cols-2 gap-x-6 gap-y-1.5">
            {extras.stats.map((s) => (
              <div key={s.label} className="flex items-baseline justify-between gap-3">
                <dt className="text-xs text-slate-500 dark:text-gray-400">{s.label}</dt>
                <dd className={clsx('text-sm font-semibold tabular-nums text-slate-900 dark:text-white', s.accent)}>
                  {s.value}
                </dd>
              </div>
            ))}
          </dl>
        )}

        {/* Fortschrittsbalken (Monatsabschluss-Fortschritt) */}
        {extras?.progress && (
          <div className="mt-2 flex max-w-md items-center gap-3">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-200 dark:bg-gray-700">
              <div
                className="h-full rounded-full bg-primary-600 transition-all"
                style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
              />
            </div>
            <span className="text-xs font-medium tabular-nums text-slate-500 dark:text-gray-400">{progressPct} %</span>
          </div>
        )}

        {/* Namenslisten (Salden-Ausreißer, fehlendes GPS) */}
        {extras?.rows && extras.rows.length > 0 && (
          <ul className="mt-2 max-w-md space-y-0.5">
            {extras.rows.map((r, idx) => (
              <li key={`${r.label}:${idx}`} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="truncate text-slate-600 dark:text-gray-400">{r.label}</span>
                <span className={clsx('font-medium tabular-nums text-slate-900 dark:text-white', r.accent)}>{r.value}</span>
              </li>
            ))}
          </ul>
        )}
        {extras?.note && <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">{extras.note}</p>}

        {item.actionRequired && item.link && (
          <button
            type="button"
            onClick={() => navigate(item.link!)}
            className="mt-2 inline-flex items-center rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-primary-700"
          >
            {t('feed.checkNow')}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Feed — der namensgebende Aktivitäts-Stream: Kennzahlen, Filter-Chips und
 * chronologische Karten, gruppiert nach Heute / Diese Woche / Demnächst.
 */
export default function Feed() {
  const t = useT();
  const { user } = useAuthStore();
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<Tab>('all');

  const isManager = !!user && (user.isSuperAdmin || ['admin', 'buchhaltung', 'verwaltung'].includes(user.role));

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const res = await api.get('/feed');
      setItems(res.data.items || []);
      setLoadError('');
    } catch {
      setLoadError(t('feed.loadError'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
    // Auto-Refresh: alle 10s STILL im Hintergrund (kein Spinner — Items werden
    // sanft per State-Replace aktualisiert). Bei verstecktem Tab pausieren und
    // beim Sichtbarwerden/Fokus sofort einmal nachladen.
    const iv = window.setInterval(() => {
      if (document.visibilityState === 'visible') load(true);
    }, 10_000);
    const onFocus = () => load(true);
    const onVisibility = () => { if (document.visibilityState === 'visible') load(true); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(iv);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [load]);

  // Kennzahlen aus den Items ableiten.
  const presence = items.find((i) => i.type === 'presence_summary');
  const balance = items.find((i) => i.type === 'balance');
  const stampStatus = items.find((i) => i.type === 'stamp_status');
  const openTasks = items.filter((i) => i.actionRequired).length;

  const counts = useMemo(() => ({
    all: items.length,
    tasks: items.filter((i) => i.actionRequired || i.priority === 'high').length,
    company: items.filter(isCompany).length,
    team: items.filter((i) => !isPersonal(i) && !isCompany(i)).length,
    personal: items.filter(isPersonal).length,
  }), [items]);

  const filtered = useMemo(() => {
    switch (tab) {
      case 'tasks': return items.filter((i) => i.actionRequired || i.priority === 'high');
      case 'company': return items.filter(isCompany);
      case 'team': return items.filter((i) => !isPersonal(i) && !isCompany(i));
      case 'personal': return items.filter(isPersonal);
      default: return items;
    }
  }, [items, tab]);

  // Gruppierung: Heute / Diese Woche (±7 Tage) / Demnächst (weiter weg).
  const groups = useMemo(() => {
    const todayStr = ymd(new Date());
    const today: FeedItem[] = [];
    const week: FeedItem[] = [];
    const upcoming: FeedItem[] = [];
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const in7 = new Date(now); in7.setDate(in7.getDate() + 7);
    for (const item of filtered) {
      const d = new Date(item.timestamp);
      if (ymd(d) === todayStr) today.push(item);
      else if (d > in7) upcoming.push(item);
      else week.push(item);
    }
    return [
      { key: 'today', label: t('feed.groups.today'), items: today },
      { key: 'thisWeek', label: t('feed.groups.thisWeek'), items: week },
      { key: 'upcoming', label: t('feed.groups.upcoming'), items: upcoming },
    ].filter((g) => g.items.length > 0);
  }, [filtered, t]);

  const kpis: Array<{ key: string; label: string; value: string; accent?: string }> = [];
  if (isManager) {
    kpis.push({
      key: 'present',
      label: t('feed.kpi.presentNow'),
      value: presence ? t('feed.kpi.presentNowValue', { present: presence.data.present ?? 0, total: presence.data.total ?? 0 }) : '–',
    });
  }
  kpis.push({
    key: 'balance',
    label: t('feed.kpi.myBalance'),
    value: balance ? formatSignedMinutes(balance.data.balanceMinutes || 0) : '–',
    accent: balance && (balance.data.balanceMinutes || 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400',
  });
  kpis.push({
    key: 'tasks',
    label: t('feed.kpi.openTasks'),
    value: String(openTasks),
    accent: openTasks > 0 ? 'text-amber-600 dark:text-amber-400' : undefined,
  });
  kpis.push({
    key: 'worked',
    label: t('feed.kpi.todayWorked'),
    value: stampStatus ? formatMinutes(stampStatus.data.workedMinutes || 0) : '–',
  });

  const tabs: Array<{ key: Tab; label: string; count: number }> = [
    { key: 'all', label: t('feed.tabs.all'), count: counts.all },
    { key: 'tasks', label: t('feed.tabs.tasks'), count: counts.tasks },
    // „Unternehmen" nur für Verwalter-Rollen (Mitarbeiter erhalten ohnehin keine Items).
    ...(isManager ? [{ key: 'company' as Tab, label: t('feed.tabs.company'), count: counts.company }] : []),
    { key: 'team', label: t('feed.tabs.team'), count: counts.team },
    { key: 'personal', label: t('feed.tabs.personal'), count: counts.personal },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <ErrorBanner message={loadError} onRetry={() => load()} />

      {/* Kopf */}
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">{t('feed.title')}</h1>
        <span className="text-xs text-slate-400 dark:text-gray-500">{t('feed.autoUpdated')}</span>
        <p className="w-full text-sm text-slate-600 dark:text-gray-400">{t('feed.subtitle')}</p>
      </div>

      {/* Kennzahlen-Kacheln */}
      <div className={clsx('grid grid-cols-2 gap-4', kpis.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
        {kpis.map((k) => (
          <div key={k.key} className="card">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-gray-400">{k.label}</p>
            <p className={clsx('mt-1 text-2xl font-bold tabular-nums text-slate-900 dark:text-white', k.accent)}>
              {loading ? '…' : k.value}
            </p>
          </div>
        ))}
      </div>

      {/* Filter-Chips */}
      <div className="flex flex-wrap gap-2">
        {tabs.map((tb) => (
          <button
            key={tb.key}
            type="button"
            onClick={() => setTab(tb.key)}
            className={clsx(
              'inline-flex items-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium transition-colors',
              tab === tb.key
                ? 'bg-primary-600 text-white shadow-sm'
                : 'bg-white text-slate-600 hover:bg-slate-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-700',
            )}
          >
            {tb.label}
            <span className={clsx(
              'rounded-full px-1.5 py-0.5 text-xs tabular-nums',
              tab === tb.key ? 'bg-white/20' : 'bg-slate-100 text-slate-500 dark:bg-gray-700 dark:text-gray-400',
            )}>
              {tb.count}
            </span>
          </button>
        ))}
      </div>

      {/* Lade-Skeleton */}
      {loading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="card animate-pulse">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-gray-200 dark:bg-gray-700" />
                <div className="flex-1 space-y-2 py-1">
                  <div className="h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-700" />
                  <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-700" />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Stream, gruppiert */}
      {!loading && groups.map((g) => (
        <section key={g.key}>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500 dark:text-gray-400">{g.label}</h2>
          <div className="space-y-3">
            {g.items.map((item) => <FeedCard key={item.id} item={item} />)}
          </div>
        </section>
      ))}

      {/* Leerzustand */}
      {!loading && filtered.length === 0 && (
        <div className="card py-12 text-center">
          <NewspaperIcon className="mx-auto mb-4 h-12 w-12 text-slate-400 dark:text-gray-500" />
          <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{t('feed.empty.title')}</h3>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-600 dark:text-gray-400">{t('feed.empty.text')}</p>
        </div>
      )}
    </div>
  );
}
