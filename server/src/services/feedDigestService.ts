import { AuditLog, AuditAction } from '../models/AuditLog';
import storageService from './storageService';
import { ymdLocal, addDays, localDayStart } from './timeCalcService';

/**
 * feedDigestService — Aggregations-Logik für die Unternehmens-/Digest-Items
 * des Feeds (GET /api/feed). Enthält ausschließlich PURE Rechenfunktionen
 * (unit-testbar, keine Queries) plus die Backup-Metadaten-Abfrage.
 *
 * Die eigentlichen Queries bleiben gebündelt im feed.controller (ein
 * Promise.all, kleine Zeitfenster, keine N+1).
 */

// ---------------------------------------------------------------------------
// Schwellen/Konstanten (bewusst als benannte Konstanten, siehe Aufgabenstellung)
// ---------------------------------------------------------------------------

/** balance_outlier: Überstundensaldo ÜBER +20 h gilt als Ausreißer nach oben. */
export const BALANCE_OUTLIER_OVER_MINUTES = 20 * 60;
/** balance_outlier: Saldo UNTER −10 h gilt als Ausreißer nach unten. */
export const BALANCE_OUTLIER_UNDER_MINUTES = -10 * 60;
/** balance_outlier: max. Namen pro Karte (Rest nur als Zähler). */
export const OUTLIER_MAX_NAMES = 5;
/** backup_status: letztes Backup älter als 7 Tage → Warnung. */
export const BACKUP_STALE_DAYS = 7;
/** month_progress: nach dem 5. des Monats gilt ein offener Vormonat als überfällig. */
export const MONTH_CLOSE_DEADLINE_DAY = 5;
/** upcoming_exit: Austritte innerhalb der nächsten 30 Tage. */
export const EXIT_LOOKAHEAD_DAYS = 30;
/** birthday_upcoming: Geburtstage der nächsten 7 Tage. */
export const BIRTHDAY_LOOKAHEAD_DAYS = 7;
/** auto_capped_last_night: max. Namen im Item. */
export const AUTO_CAP_MAX_NAMES = 8;
/** gps_missing: max. Einträge (Name + Datum) in der gebündelten Karte. */
export const GPS_MISSING_MAX_ENTRIES = 10;

// ---------------------------------------------------------------------------
// Zeit-Helfer
// ---------------------------------------------------------------------------

/** Montag 00:00 (lokal) der Woche, in der `now` liegt. */
export function mondayOfWeek(now: Date): Date {
  const d = localDayStart(ymdLocal(now));
  const jsDay = d.getDay(); // 0 = So … 6 = Sa
  const diff = jsDay === 0 ? -6 : 1 - jsDay;
  return addDays(d, diff);
}

/** 'YYYY-MM' des Vormonats von `now`. */
export function previousMonthKey(now: Date): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Erster/letzter Tag ('YYYY-MM-DD') eines 'YYYY-MM'-Monats. */
export function monthRange(monthKey: string): { startYmd: string; endYmd: string } {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  const mm = String(m).padStart(2, '0');
  return { startYmd: `${y}-${mm}-01`, endYmd: `${y}-${mm}-${String(last).padStart(2, '0')}` };
}

/** 'YYYY-MM-DD' aus DATEONLY-String ODER Date (SQLite liefert je nach Pfad beides). */
export function toYmd(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === 'string') {
    const m = /^(\d{4}-\d{2}-\d{2})/.exec(value);
    if (m) return m[1];
  }
  const d = new Date(value as any);
  return isNaN(d.getTime()) ? null : ymdLocal(d);
}

// ---------------------------------------------------------------------------
// Wochen-Digest (company_week_digest / my_week_summary / absence_rate_today)
// ---------------------------------------------------------------------------

export interface WeekRow {
  userId: number;
  date: string;
  workedMinutes: number;
  targetMinutes: number;
  balanceMinutes: number;
  absence?: string | null;
}

export interface CompanyWeekSummary {
  workedMinutes: number;
  targetMinutes: number;
  /** Mitarbeiter, deren Wochensaldo (Summe balanceMinutes) negativ ist. */
  behindCount: number;
  /** Ø-Wochensaldo über ALLE Mitarbeiter im Scope (ohne Tage = 0). */
  avgBalanceMinutes: number;
  employeeCount: number;
}

/** Firmen-Wochensummen aus EINMAL geladenen Wochen-WorkDays (kein N+1). */
export function summarizeCompanyWeek(rows: WeekRow[], memberIds: Set<number>): CompanyWeekSummary {
  let worked = 0;
  let target = 0;
  const perUser = new Map<number, number>();
  for (const r of rows) {
    if (!memberIds.has(r.userId)) continue; // z. B. inaktive Nutzer ausblenden
    worked += r.workedMinutes || 0;
    target += r.targetMinutes || 0;
    perUser.set(r.userId, (perUser.get(r.userId) || 0) + (r.balanceMinutes || 0));
  }
  let behind = 0;
  let totalBalance = 0;
  for (const bal of perUser.values()) {
    totalBalance += bal;
    if (bal < 0) behind += 1;
  }
  const count = memberIds.size;
  return {
    workedMinutes: worked,
    targetMinutes: target,
    behindCount: behind,
    avgBalanceMinutes: count > 0 ? Math.round(totalBalance / count) : 0,
    employeeCount: count,
  };
}

/** Eigene Wochensummen (Ist/Soll/Saldo) aus denselben Wochen-Rows. */
export function summarizeOwnWeek(rows: WeekRow[], userId: number): {
  workedMinutes: number; targetMinutes: number; balanceMinutes: number;
} {
  let worked = 0; let target = 0; let balance = 0;
  for (const r of rows) {
    if (r.userId !== userId) continue;
    worked += r.workedMinutes || 0;
    target += r.targetMinutes || 0;
    balance += r.balanceMinutes || 0;
  }
  return { workedMinutes: worked, targetMinutes: target, balanceMinutes: balance };
}

export interface AbsenceRate {
  absentCount: number;
  total: number;
  /** Anzahl je Abwesenheitsart (vacation/sick/holiday/…). */
  byKind: Record<string, number>;
}

/** Heutige Abwesenheitsquote; null, wenn heute niemand abwesend ist. */
export function absenceRateToday(rows: WeekRow[], todayYmd: string, memberIds: Set<number>): AbsenceRate | null {
  const byKind: Record<string, number> = {};
  let absent = 0;
  for (const r of rows) {
    if (r.date !== todayYmd || !r.absence || !memberIds.has(r.userId)) continue;
    absent += 1;
    byKind[r.absence] = (byKind[r.absence] || 0) + 1;
  }
  if (absent === 0) return null;
  return { absentCount: absent, total: memberIds.size, byKind };
}

// ---------------------------------------------------------------------------
// balance_outlier
// ---------------------------------------------------------------------------

export interface BalanceTotal { userId: number; balanceMinutes: number; }

/** Ausreißer über/unter den Schwellen, sortiert nach Extremwert. */
export function pickBalanceOutliers(totals: BalanceTotal[]): { over: BalanceTotal[]; under: BalanceTotal[] } {
  const over = totals
    .filter((t) => (t.balanceMinutes || 0) > BALANCE_OUTLIER_OVER_MINUTES)
    .sort((a, b) => b.balanceMinutes - a.balanceMinutes);
  const under = totals
    .filter((t) => (t.balanceMinutes || 0) < BALANCE_OUTLIER_UNDER_MINUTES)
    .sort((a, b) => a.balanceMinutes - b.balanceMinutes);
  return { over, under };
}

// ---------------------------------------------------------------------------
// auto_capped_last_night
// ---------------------------------------------------------------------------

export interface StampRowLike { userId: number; type: string; timestamp: Date | string; source?: string | null; }

/**
 * Nutzer, die "letzte Nacht" (Kappungslauf für den gestrigen Tag) automatisch
 * ausgestempelt wurden — aus den bereits geladenen 48h-Stempeln abgeleitet
 * (source 'auto_cap', out-Stempel ab gestern 00:00).
 */
export function autoCappedUserIds(entries: StampRowLike[], yesterdayStart: Date): number[] {
  const ids = new Set<number>();
  for (const e of entries) {
    if (e.source !== 'auto_cap' || e.type !== 'out') continue;
    if (new Date(e.timestamp) < yesterdayStart) continue;
    ids.add(e.userId);
  }
  return [...ids];
}

// ---------------------------------------------------------------------------
// gps_missing
// ---------------------------------------------------------------------------

/**
 * gps_missing nur liefern, wenn die Firmen-Settings das (parallel eingeführte)
 * Feld `gpsMode` haben UND es 'warn' oder 'required' ist. Defensiv gelesen:
 * fehlt das Feld (noch), wird das Item NICHT geliefert.
 */
export function gpsMissingEnabled(settings: unknown): boolean {
  const mode = (settings as any)?.gpsMode;
  return mode === 'warn' || mode === 'required';
}

// ---------------------------------------------------------------------------
// month_progress
// ---------------------------------------------------------------------------

export interface ClosureRowLike { companyId: number; userId?: number | null; }

/**
 * Abschluss-Fortschritt des Vormonats: userId NULL = Firmen-Abschluss (zählt
 * alle Mitarbeiter der Firma), sonst Einzelabschluss.
 */
export function computeMonthProgress(
  users: Array<{ id: number; companyId?: number | null }>,
  closures: ClosureRowLike[],
): { closed: number; total: number } {
  const companyClosed = new Set<number>();
  const userClosed = new Set<number>();
  for (const c of closures) {
    if (c.userId == null) companyClosed.add(c.companyId);
    else userClosed.add(c.userId);
  }
  let closed = 0;
  for (const u of users) {
    if (userClosed.has(u.id) || (u.companyId != null && companyClosed.has(u.companyId))) closed += 1;
  }
  return { closed, total: users.length };
}

// ---------------------------------------------------------------------------
// upcoming_exit / birthday_upcoming
// ---------------------------------------------------------------------------

/** Austritte in [heute, heute + EXIT_LOOKAHEAD_DAYS]. */
export function upcomingExits(
  users: Array<{ id: number; exitDate?: unknown }>,
  todayStart: Date,
  days = EXIT_LOOKAHEAD_DAYS,
): Array<{ userId: number; date: string }> {
  const from = ymdLocal(todayStart);
  const to = ymdLocal(addDays(todayStart, days));
  const out: Array<{ userId: number; date: string }> = [];
  for (const u of users) {
    const ymd = toYmd(u.exitDate);
    if (ymd && ymd >= from && ymd <= to) out.push({ userId: u.id, date: ymd });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Geburtstage in [heute, heute + BIRTHDAY_LOOKAHEAD_DAYS] — nächstes Auftreten
 * von Monat/Tag (Jahreswechsel wird berücksichtigt; 29.02. rutscht in
 * Nicht-Schaltjahren automatisch auf den 01.03.).
 */
export function upcomingBirthdays(
  users: Array<{ id: number; birthDate?: unknown }>,
  todayStart: Date,
  days = BIRTHDAY_LOOKAHEAD_DAYS,
): Array<{ userId: number; date: string }> {
  const from = ymdLocal(todayStart);
  const to = ymdLocal(addDays(todayStart, days));
  const out: Array<{ userId: number; date: string }> = [];
  for (const u of users) {
    const ymd = toYmd(u.birthDate);
    if (!ymd) continue;
    const [, m, d] = ymd.split('-').map(Number);
    for (const year of [todayStart.getFullYear(), todayStart.getFullYear() + 1]) {
      const occ = ymdLocal(new Date(year, m - 1, d));
      if (occ >= from && occ <= to) { out.push({ userId: u.id, date: occ }); break; }
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

// ---------------------------------------------------------------------------
// backup_status
// ---------------------------------------------------------------------------

export interface BackupStatus { reason: 'never' | 'stale'; ageDays: number | null; }

/** null = Backup frisch genug (kein Feed-Item). */
export function evaluateBackupStatus(lastBackupAt: string | null, now: Date): BackupStatus | null {
  if (!lastBackupAt) return { reason: 'never', ageDays: null };
  const age = now.getTime() - new Date(lastBackupAt).getTime();
  const ageDays = Math.floor(age / (24 * 3600 * 1000));
  if (ageDays <= BACKUP_STALE_DAYS) return null;
  return { reason: 'stale', ageDays };
}

// Backup-Historie ist relativ teuer (S3-Listing) und ändert sich selten →
// prozessweiter Cache mit kurzer TTL. Fehler (z. B. S3 nicht erreichbar)
// werden ignoriert; dann zählt nur die Audit-Historie.
const BACKUP_CACHE_TTL_MS = 10 * 60 * 1000;
let backupCache: { at: number; lastBackupAt: string | null } | null = null;

/** Nur für Tests: Cache zurücksetzen. */
export function __resetBackupCache(): void { backupCache = null; }

/**
 * Zeitpunkt des letzten Backups aus den vorhandenen Metadaten:
 * - AuditLog (entity 'Backup', action EXPORT — manueller Download-Backup)
 * - S3-Backup-Listing (storageService.listBackups), falls S3 aktiv
 * Der jüngste der beiden Zeitpunkte gewinnt; null = nie.
 */
export async function getLastBackupAt(now = new Date()): Promise<string | null> {
  if (backupCache && now.getTime() - backupCache.at < BACKUP_CACHE_TTL_MS) {
    return backupCache.lastBackupAt;
  }
  let last: string | null = null;

  try {
    const audit = await AuditLog.findOne({
      where: { entity: 'Backup', action: AuditAction.EXPORT },
      order: [['createdAt', 'DESC']],
      attributes: ['createdAt'],
    });
    if (audit?.createdAt) last = new Date(audit.createdAt).toISOString();
  } catch { /* Audit-Tabelle nicht verfügbar → ignorieren */ }

  try {
    if (await storageService.isActive()) {
      const backups = await storageService.listBackups(); // bereits absteigend sortiert
      const newest = backups.find((b) => b.lastModified)?.lastModified ?? null;
      if (newest && (!last || newest > last)) last = newest;
    }
  } catch { /* S3 nicht erreichbar/konfiguriert → nur Audit-Historie */ }

  backupCache = { at: now.getTime(), lastBackupAt: last };
  return last;
}
