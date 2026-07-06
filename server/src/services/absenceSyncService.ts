import axios from 'axios';
import dayjs from 'dayjs';
import { Op, literal } from 'sequelize';
import { IntegrationSettings } from '../models/IntegrationSettings';
import { User } from '../models/User';
import { WorkDay } from '../models/WorkDay';
import { calcWorkDay } from './timeCalcService';

/**
 * UrlaubsFeed-Kopplung: importiert genehmigte Abwesenheiten (vacation/sick) aus
 * einer UrlaubsFeed-Instanz und setzt sie als WorkDay.absence mit
 * absenceSource='urlaubsfeed'. Nicht mehr gelieferte Abwesenheiten dieser Quelle
 * werden zurückgesetzt. 'approved'/'locked' Tage werden NIE angefasst.
 */

export const SYNC_PAST_DAYS = 60;
export const SYNC_FUTURE_DAYS = 120;
const HTTP_TIMEOUT_MS = 15_000;

export interface AbsenceSyncResult {
  ok: boolean;
  from?: string;
  to?: string;
  fetched?: number;
  matchedUsers?: number;
  unmatchedEmails?: string[];
  daysSet?: number;
  daysCleared?: number;
  skippedLocked?: number;
  error?: string;
  syncedAt: string;
}

interface RemoteAbsence {
  email: string;
  employeeNumber?: string | null;
  type: 'vacation' | 'sick' | string;
  startDate: string;
  endDate: string;
}

/**
 * Basis-URL normalisieren (Schema erzwingen, trailing slash entfernen).
 * Bewusst KEIN pauschaler Privatnetz-Block wie bei S3-Endpoints: UrlaubsFeed läuft
 * in typischen Selfhost-Setups im selben LAN/auf demselben Host (nur Admins können
 * die URL setzen). Cloud-Metadata/Link-Local bleibt gesperrt.
 */
export function normalizeBaseUrl(rawUrl: string): string {
  let url = String(rawUrl || '').trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error('Ungültige UrlaubsFeed-URL');
  }
  if (/^169\.254\./.test(host) || host === 'metadata.google.internal' || host === '[fe80::1]' || /^fe80:/i.test(host.replace(/^\[|\]$/g, ''))) {
    throw new Error('Link-Local-/Metadata-Adressen sind nicht erlaubt');
  }
  return url;
}

/** Ping gegen die konfigurierte UrlaubsFeed-Instanz (Verbindungs-/Schlüsseltest). */
export async function pingUrlaubsFeed(rawUrl: string, apiKey: string): Promise<{ ok: boolean; tenant?: string; status?: number; message?: string }> {
  const base = normalizeBaseUrl(rawUrl);
  try {
    const resp = await axios.get(`${base}/api/external/ping`, {
      headers: { 'X-Api-Key': apiKey },
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (resp.status === 200 && resp.data?.ok) {
      return { ok: true, tenant: resp.data.tenant };
    }
    const message = resp.data?.message || resp.data?.error || `UrlaubsFeed antwortete mit HTTP ${resp.status}`;
    return { ok: false, status: resp.status, message };
  } catch (e: any) {
    return { ok: false, message: `UrlaubsFeed nicht erreichbar: ${e?.code || e?.message || 'unbekannter Fehler'}` };
  }
}

/** Alle Nutzer eines Mandanten (über Firmen des Tenants ODER direkt am Tenant hängend). */
async function tenantUsers(tenantId: number): Promise<User[]> {
  return User.findAll({
    where: {
      [Op.or]: [
        { companyId: { [Op.in]: literal(`(SELECT id FROM companies WHERE tenant_id = ${Number(tenantId)})`) } },
        { tenantId },
      ],
    },
    attributes: ['id', 'email'],
  });
}

/** Führt den Abwesenheits-Sync für EINEN Mandanten aus und persistiert das Ergebnis. */
export async function syncTenantAbsences(tenantId: number): Promise<AbsenceSyncResult> {
  const syncedAt = new Date();
  const settings = await IntegrationSettings.findOne({ where: { tenantId } });

  const fail = async (error: string): Promise<AbsenceSyncResult> => {
    const result: AbsenceSyncResult = { ok: false, error, syncedAt: syncedAt.toISOString() };
    if (settings) await settings.update({ lastSyncAt: syncedAt, lastSyncResult: result });
    return result;
  };

  if (!settings || !settings.urlaubsfeedUrl || !settings.urlaubsfeedApiKey) {
    return fail('UrlaubsFeed-URL und API-Key sind nicht konfiguriert.');
  }

  const from = dayjs().subtract(SYNC_PAST_DAYS, 'day').format('YYYY-MM-DD');
  const to = dayjs().add(SYNC_FUTURE_DAYS, 'day').format('YYYY-MM-DD');

  // --- Abwesenheiten abrufen ------------------------------------------------
  let absences: RemoteAbsence[];
  try {
    const base = normalizeBaseUrl(settings.urlaubsfeedUrl);
    const resp = await axios.get(`${base}/api/external/absences`, {
      params: { from, to },
      headers: { 'X-Api-Key': settings.urlaubsfeedApiKey },
      timeout: HTTP_TIMEOUT_MS,
      validateStatus: () => true,
    });
    if (resp.status !== 200 || !Array.isArray(resp.data?.absences)) {
      return fail(`UrlaubsFeed antwortete mit HTTP ${resp.status}: ${resp.data?.message || resp.data?.error || 'unerwartete Antwort'}`);
    }
    absences = resp.data.absences;
  } catch (e: any) {
    return fail(`UrlaubsFeed nicht erreichbar: ${e?.code || e?.message || 'unbekannter Fehler'}`);
  }

  // --- Auf Nutzer des Mandanten mappen (per E-Mail) --------------------------
  const users = await tenantUsers(tenantId);
  const byEmail = new Map<string, number>();
  users.forEach((u) => byEmail.set(u.email.toLowerCase(), u.id));

  // Gewünschter Zustand: (userId, date) → 'vacation' | 'sick' ('sick' gewinnt bei Überlappung).
  const desired = new Map<string, { userId: number; date: string; type: 'vacation' | 'sick' }>();
  const unmatched = new Set<string>();
  const matchedUserIds = new Set<number>();

  for (const a of absences) {
    const type = a.type === 'sick' ? 'sick' : 'vacation';
    const userId = byEmail.get(String(a.email || '').toLowerCase());
    if (!userId) {
      if (a.email) unmatched.add(a.email);
      continue;
    }
    matchedUserIds.add(userId);
    let d = dayjs(a.startDate).isBefore(from) ? dayjs(from) : dayjs(a.startDate);
    const end = dayjs(a.endDate).isAfter(to) ? dayjs(to) : dayjs(a.endDate);
    if (!d.isValid() || !end.isValid()) continue;
    for (; !d.isAfter(end); d = d.add(1, 'day')) {
      const date = d.format('YYYY-MM-DD');
      const key = `${userId}|${date}`;
      const prev = desired.get(key);
      if (!prev || type === 'sick') desired.set(key, { userId, date, type });
    }
  }

  let daysSet = 0;
  let daysCleared = 0;
  let skippedLocked = 0;

  // --- Abwesenheiten setzen ---------------------------------------------------
  for (const { userId, date, type } of desired.values()) {
    let wd = await WorkDay.findOne({ where: { userId, date } });
    if (wd && (wd.status === 'approved' || wd.status === 'locked')) {
      skippedLocked++;
      continue;
    }
    if (!wd) {
      // Tag über den regulären Berechnungsweg anlegen (setzt Soll/Status korrekt).
      wd = await calcWorkDay(userId, date);
      if (!wd) continue;
    }
    if (wd.absence !== type || wd.absenceSource !== 'urlaubsfeed') {
      await wd.update({ absence: type, absenceSource: 'urlaubsfeed' });
      // Neu berechnen: calcWorkDay übernimmt die bestehende absence und setzt
      // Sollzeit-Gutschrift/Status ('target_credited').
      await calcWorkDay(userId, date);
      daysSet++;
    }
  }

  // --- Entfernte Abwesenheiten zurücksetzen (nur Quelle 'urlaubsfeed') --------
  const userIds = users.map((u) => u.id);
  if (userIds.length > 0) {
    const stale = await WorkDay.findAll({
      where: {
        userId: { [Op.in]: userIds },
        date: { [Op.gte]: from, [Op.lte]: to },
        absenceSource: 'urlaubsfeed',
      },
    });
    for (const wd of stale) {
      if (desired.has(`${wd.userId}|${wd.date}`)) continue;
      if (wd.status === 'approved' || wd.status === 'locked') {
        skippedLocked++;
        continue;
      }
      await wd.update({ absence: null, absenceSource: null });
      await calcWorkDay(wd.userId, wd.date);
      daysCleared++;
    }
  }

  const result: AbsenceSyncResult = {
    ok: true,
    from,
    to,
    fetched: absences.length,
    matchedUsers: matchedUserIds.size,
    unmatchedEmails: [...unmatched].slice(0, 20),
    daysSet,
    daysCleared,
    skippedLocked,
    syncedAt: syncedAt.toISOString(),
  };
  await settings.update({ lastSyncAt: syncedAt, lastSyncResult: result });
  return result;
}

/** Alle Mandanten mit aktiviertem Sync durchlaufen (täglicher Job). */
export async function runAbsenceSync(): Promise<void> {
  try {
    const all = await IntegrationSettings.findAll({ where: { syncEnabled: true } });
    for (const s of all) {
      try {
        const result = await syncTenantAbsences(s.tenantId);
        console.log(`AbsenceSync: Tenant ${s.tenantId} → ${result.ok ? `ok (set=${result.daysSet}, cleared=${result.daysCleared})` : `Fehler: ${result.error}`}`);
      } catch (e) {
        console.error(`AbsenceSync: Tenant ${s.tenantId} fehlgeschlagen:`, e);
      }
    }
  } catch (e) {
    console.error('AbsenceSync-Job fehlgeschlagen:', e);
  }
}

let syncTimer: NodeJS.Timeout | null = null;

/** Startet den täglichen Sync-Job um 03:00 (lokale Serverzeit). */
export function startAbsenceSyncJob(): void {
  const schedule = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(3, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    syncTimer = setTimeout(async () => {
      await runAbsenceSync();
      schedule(); // nächsten Lauf planen (robust gegen DST-Wechsel)
    }, next.getTime() - now.getTime());
    if (syncTimer.unref) syncTimer.unref();
  };
  schedule();
  console.log('AbsenceSync-Job geplant (täglich 03:00).');
}

export function stopAbsenceSyncJob(): void {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = null;
}
