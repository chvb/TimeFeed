import { Op, fn, col } from 'sequelize';
import { TimeEntry } from '../models/TimeEntry';
import { WorkDay } from '../models/WorkDay';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { CorrectionRequest } from '../models/CorrectionRequest';
import { SystemSettings } from '../models/SystemSettings';
import { SettingsController } from '../controllers/settings.controller';
import { AuditService } from './auditService';
import { AuditLog, AuditAction, AuditCategory } from '../models/AuditLog';
import { purgeExpiredTrash } from './trashService';
import { calcWorkDay, pairShifts, ymdLocal, localDayStart, addDays } from './timeCalcService';
import { ensureSecondaryAndRetentionColumns } from './secondarySchemaEnsure';
import { runSecondarySync, SECONDARY_SYNC_INTERVAL_MS } from './secondarySyncService';

/**
 * Täglicher Zeit-Abschlussjob (02:00 Uhr):
 * 1. Auto-Kappung: Vortage mit offenem 'in' (Ausstempeln vergessen) erhalten —
 *    wenn autoCapEnabled — ein 'out' mit source='auto_cap' zur autoCapTime des
 *    jeweiligen Arbeitstags; der Tag wird danach neu berechnet (Flag 'auto_capped').
 * 2. Alle WorkDays der letzten 3 Tage werden neu berechnet (Nachzügler-Stempel,
 *    geänderte Einstellungen, Feiertags-Updates).
 * 3. Aufbewahrung/Löschkonzept (runRetentionCleanup): GPS-Daten nullen und
 *    abgelaufene Zeitdaten monatsweise löschen.
 *
 * Zusätzlich startet startTimeRecalcJob() den 15-Minuten-Intervall für den
 * Sekundär-S3-Sync (Mirror + Backfill, siehe secondarySyncService).
 */

const settingsController = new SettingsController();

const RECALC_DAYS = 3;

export async function runTimeRecalc(now: Date = new Date()): Promise<void> {
  const today = ymdLocal(now);
  const todayStart = localDayStart(today);
  const windowStart = addDays(todayStart, -RECALC_DAYS);

  try {
    // --- 1. Auto-Kappung offener Schichten der Vortage --------------------
    const entries = await TimeEntry.findAll({
      where: {
        isCancelled: false,
        timestamp: { [Op.gte]: windowStart, [Op.lte]: now },
      },
      order: [['userId', 'ASC'], ['timestamp', 'ASC']],
    });

    const byUser = new Map<number, TimeEntry[]>();
    for (const e of entries) {
      const list = byUser.get(e.userId) || [];
      list.push(e);
      byUser.set(e.userId, list);
    }

    for (const [userId, userEntries] of byUser) {
      const shifts = pairShifts(userEntries.map((e) => ({
        type: e.type, timestamp: new Date(e.timestamp), lat: e.lat, lng: e.lng, source: e.source,
      })));
      // Offene Schichten, die an einem VORTAG begonnen haben.
      const openOld = shifts.filter((s) => !s.outAt && s.inAt < todayStart);
      if (openOld.length === 0) continue;

      const user = await User.findByPk(userId, { attributes: ['id', 'companyId'] });
      if (!user) continue;
      const settings = await settingsController.getOrCreateSettings(user.companyId ?? null);
      if (!settings.autoCapEnabled) continue;

      for (const shift of openOld) {
        const shiftDay = ymdLocal(shift.inAt);
        const [rawH, rawM] = String(settings.autoCapTime || '23:00').split(':').map(Number);
        // Kein Falsy-Fallback: 00:xx (h=0) bzw. :00 (m=0) sind gültig und dürfen nicht
        // auf 23:xx/:.. verfälscht werden.
        const h = Number.isFinite(rawH) ? rawH : 23;
        const m = Number.isFinite(rawM) ? rawM : 0;
        let capAt = localDayStart(shiftDay);
        capAt.setHours(h, m, 0, 0);
        // Einstempeln NACH der Kappungszeit (z. B. 23:30 bei Kappung 23:00):
        // dann direkt am 'in' kappen (keine negative Schichtdauer erzeugen).
        if (capAt <= shift.inAt) capAt = new Date(shift.inAt);

        await TimeEntry.create({
          userId,
          companyId: user.companyId ?? null,
          type: 'out',
          timestamp: capAt,
          source: 'auto_cap',
          note: `Automatisch ausgestempelt (Tagesabschluss ${settings.autoCapTime})`,
        });
        await calcWorkDay(userId, shiftDay);
        console.log(`TimeRecalc: Auto-Kappung für User ${userId} am ${shiftDay} um ${settings.autoCapTime}.`);
      }
      // Web-Push an Betroffene: „Ausstempeln vergessen" (fire-and-forget).
      import('./pushService').then((p) => p.notifyAutoCappedUsers([userId])).catch(() => { /* unkritisch */ });
    }

    // --- 2. WorkDays der letzten 3 Tage neu berechnen ----------------------
    // Betroffene Nutzer: alle mit Stempelungen ODER bestehenden WorkDays im Fenster.
    const userIds = new Set<number>(byUser.keys());
    const wds = await WorkDay.findAll({
      where: { date: { [Op.gte]: ymdLocal(windowStart), [Op.lt]: today } },
      attributes: ['userId'],
    });
    for (const wd of wds) userIds.add(wd.userId);

    for (const userId of userIds) {
      for (let i = RECALC_DAYS; i >= 1; i--) {
        await calcWorkDay(userId, ymdLocal(addDays(todayStart, -i)));
      }
    }

    console.log(`TimeRecalc: ${userIds.size} Nutzer über ${RECALC_DAYS} Tage neu berechnet.`);
  } catch (e) {
    console.error('TimeRecalc-Job fehlgeschlagen:', e);
  }
}

// ---------------------------------------------------------------------------
// Aufbewahrung/Löschkonzept (Retention)
// ---------------------------------------------------------------------------

/**
 * Berechnet die Löschgrenzen (nur GANZE Monate: Grenze ist jeweils der lokale
 * Monatsanfang N Monate vor dem aktuellen Monat; alles STRIKT davor ist fällig).
 *
 * monthsEntries wird hart auf mindestens 24 geklemmt: § 16 Abs. 2 ArbZG
 * verlangt die Aufbewahrung der Arbeitszeitnachweise für mindestens zwei Jahre —
 * eine kürzere Frist darf auch bei fehlerhafter Konfiguration nie wirksam werden.
 */
export function retentionCutoffs(now: Date, monthsEntries: number, monthsGps: number): {
  entriesBefore: Date;
  gpsBefore: Date;
  entriesBeforeYmd: string;
} {
  const entriesMonths = Math.max(24, Number.isFinite(monthsEntries) ? Math.floor(monthsEntries) : 24);
  const gpsMonths = Math.max(1, Number.isFinite(monthsGps) ? Math.floor(monthsGps) : 3);
  const monthStartMinus = (m: number) => new Date(now.getFullYear(), now.getMonth() - m, 1, 0, 0, 0, 0);
  const entriesBefore = monthStartMinus(entriesMonths);
  return {
    entriesBefore,
    gpsBefore: monthStartMinus(gpsMonths),
    entriesBeforeYmd: ymdLocal(entriesBefore),
  };
}

export interface RetentionResult {
  gpsCleared: number;
  entriesDeleted: number;
  workDaysDeleted: number;
  correctionsDeleted: number;
}

/**
 * Nächtlicher Aufräumjob:
 * (a) GPS-Spalten (lat/lng/accuracy) von TimeEntries älter als retentionMonthsGps → NULL
 *     (Datenminimierung — Standortdaten werden nur kurz benötigt).
 * (b) TimeEntries + WorkDays + entschiedene ("abgelaufene") CorrectionRequests, die älter
 *     als retentionMonthsEntries sind, löschen — nur ganze Monate, mit Audit-Log der Anzahl.
 *
 * Hinweis zu den Modell-Hooks: TimeEntry ist per beforeUpdate/beforeDestroy als
 * unveränderliches Journal geschützt. Diese Hooks greifen nur bei INSTANZ-Operationen;
 * die Bulk-Operationen hier (Model.update/Model.destroy ohne individualHooks) laufen
 * bewusst daran vorbei — die Löschung nach Fristablauf ist datenschutzrechtlich
 * geboten und ersetzt keine fachliche Korrektur.
 */
/** Sicherheits-Aufbewahrung für Audit-Logs (IP/User-Agent): Standard 12 Monate. */
const AUDIT_LOG_RETENTION_MONTHS = 12;

/** Aufbewahrungs-Einstellung eines Scopes lesen, OHNE eine Firmen-Zeile neu anzulegen. */
async function retentionSettingsFor(companyId: number | null): Promise<{ entries: number; gps: number }> {
  let s: SystemSettings | null = null;
  if (companyId != null) s = await SystemSettings.findOne({ where: { companyId } });
  if (!s) s = await settingsController.getOrCreateSettings(null); // globale Vorlage
  return { entries: s.retentionMonthsEntries ?? 24, gps: s.retentionMonthsGps ?? 3 };
}

/** Alle Firmen-Scopes, die in den Daten vorkommen (inkl. null = ohne Firma). */
async function retentionScopes(): Promise<Array<number | null>> {
  const ids = new Set<number | null>([null]);
  (await Company.findAll({ attributes: ['id'], raw: true })).forEach((c: any) => ids.add(c.id));
  // Orphan-Sicherung: Firmen-IDs, die nur noch in Zeitdaten stehen (Firma evtl. gelöscht) —
  // sonst würden deren Altdaten NIE gelöscht (Compliance).
  (await TimeEntry.findAll({ attributes: [[fn('DISTINCT', col('company_id')), 'cid']], raw: true }) as any[])
    .forEach((r) => ids.add(r.cid == null ? null : Number(r.cid)));
  return Array.from(ids);
}

export async function runRetentionCleanup(now: Date = new Date()): Promise<RetentionResult> {
  const total: RetentionResult = { gpsCleared: 0, entriesDeleted: 0, workDaysDeleted: 0, correctionsDeleted: 0 };

  // Pro Firma mit deren EIGENER Aufbewahrungsfrist löschen (globale Vorlage für Nutzer ohne
  // Firma). Der 24-Monate-Boden (§ 16 ArbZG) greift in retentionCutoffs für jeden Scope.
  for (const companyId of await retentionScopes()) {
    const { entries: mEntries, gps: mGps } = await retentionSettingsFor(companyId);
    const { entriesBefore, gpsBefore, entriesBeforeYmd } = retentionCutoffs(now, mEntries, mGps);
    const scope: any = companyId == null ? { companyId: null } : { companyId };

    // (b zuerst) Abgelaufene Zeitdaten löschen — vor der GPS-Nullung, damit gleich zu
    // löschende Zeilen nicht mitgezählt werden.
    total.entriesDeleted += await TimeEntry.destroy({ where: { ...scope, timestamp: { [Op.lt]: entriesBefore } } });
    // (a) GPS-Daten der verbleibenden alten Einträge nullen.
    const [gpsCleared] = await TimeEntry.update(
      { lat: null, lng: null, accuracy: null },
      { where: {
          ...scope,
          timestamp: { [Op.lt]: gpsBefore },
          [Op.or]: [{ lat: { [Op.ne]: null } }, { lng: { [Op.ne]: null } }, { accuracy: { [Op.ne]: null } }],
        } as any },
    );
    total.gpsCleared += gpsCleared;
    // Vor dem Löschen alter WorkDays deren Netto-Saldo je Nutzer in openingBalanceMinutes
    // aufnehmen — sonst „springt" das kumulierte Zeitkonto (Saldo = Summe der WorkDays).
    const wdScope: any = { ...scope, date: { [Op.lt]: entriesBeforeYmd } };
    const balances = await WorkDay.findAll({
      where: wdScope,
      attributes: ['userId', [fn('SUM', col('balance_minutes')), 'saldo']],
      group: ['userId'],
      raw: true,
    }) as any[];
    for (const b of balances) {
      const add = Math.round(Number(b.saldo) || 0);
      if (add !== 0) await User.increment({ openingBalanceMinutes: add }, { where: { id: b.userId } });
    }
    total.workDaysDeleted += await WorkDay.destroy({ where: wdScope });
    // "Abgelaufen" = bereits entschieden; offene (pending) Anträge bleiben bestehen.
    total.correctionsDeleted += await CorrectionRequest.destroy({
      where: { ...scope, date: { [Op.lt]: entriesBeforeYmd }, status: { [Op.ne]: 'pending' } },
    });
  }

  // Audit-Logs beschneiden: IP/User-Agent/Login-Historie nicht unbegrenzt aufbewahren.
  const auditBefore = new Date(now.getFullYear(), now.getMonth() - AUDIT_LOG_RETENTION_MONTHS, 1, 0, 0, 0, 0);
  const auditLogsDeleted = await AuditLog.destroy({ where: { createdAt: { [Op.lt]: auditBefore } } });

  const changed = total.gpsCleared + total.entriesDeleted + total.workDaysDeleted + total.correctionsDeleted + auditLogsDeleted;
  if (changed > 0) {
    await AuditService.log({
      action: AuditAction.CLEANUP,
      category: AuditCategory.SYSTEM,
      entity: 'Retention',
      additionalData: { ...total, auditLogsDeleted, auditCutoff: ymdLocal(auditBefore) },
    });
    console.log(
      `Retention: entriesDeleted=${total.entriesDeleted}, gpsCleared=${total.gpsCleared}, ` +
      `workDaysDeleted=${total.workDaysDeleted}, correctionsDeleted=${total.correctionsDeleted}, ` +
      `auditLogsDeleted=${auditLogsDeleted}.`
    );
  }
  return total;
}

let recalcTimer: NodeJS.Timeout | null = null;
let secondarySyncTimer: NodeJS.Timeout | null = null;

/**
 * Startet den täglichen Job um 02:00 (lokale Serverzeit) sowie den
 * 15-Minuten-Intervall für den Sekundär-S3-Sync.
 */
export function startTimeRecalcJob(): void {
  const schedule = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    recalcTimer = setTimeout(async () => {
      await runTimeRecalc();
      // Aufbewahrung nach dem Tagesabschluss; Fehler dürfen die Job-Kette nicht stoppen.
      await runRetentionCleanup().catch((e) => console.error('Retention-Job fehlgeschlagen:', e));
      // Papierkorb endgültig leeren (gelöschte Mitarbeiter inkl. Passwort-/PIN-Hash nach
      // Ablauf der Frist wirklich entfernen) — sonst blieben die Snapshots unbegrenzt liegen.
      await purgeExpiredTrash().catch((e) => console.error('Papierkorb-Bereinigung fehlgeschlagen:', e));
      // GPS-Warn-Digest (gpsMode='warn'): eine Sammel-Mail pro Firma für den Vortag.
      const { runGpsWarnDigest } = await import('./gpsDigestService');
      await runGpsWarnDigest().catch((e) => console.error('GPS-Digest fehlgeschlagen:', e));
      schedule(); // nächsten Lauf planen (robust gegen DST-Wechsel)
    }, next.getTime() - now.getTime());
    // Der Timer soll einen Shutdown nicht blockieren.
    if (recalcTimer.unref) recalcTimer.unref();
  };
  schedule();
  console.log('TimeRecalc-Job geplant (täglich 02:00, inkl. Retention-Cleanup).');

  // Neue Spalten (Sekundär-S3/Retention) idempotent sicherstellen, danach den
  // Sekundär-Sync-Intervall (Mirror + Backfill) starten.
  ensureSecondaryAndRetentionColumns()
    .catch((e) => console.error('Sekundär-/Retention-Spaltenmigration fehlgeschlagen:', e))
    .finally(() => {
      if (secondarySyncTimer) return;
      secondarySyncTimer = setInterval(() => {
        runSecondarySync().catch((e: any) => console.warn('SecondarySync fehlgeschlagen:', e?.message));
      }, SECONDARY_SYNC_INTERVAL_MS);
      if (secondarySyncTimer.unref) secondarySyncTimer.unref();
      console.log('SecondarySync-Intervall gestartet (alle 15 Min).');
    });
}

export function stopTimeRecalcJob(): void {
  if (recalcTimer) clearTimeout(recalcTimer);
  recalcTimer = null;
  if (secondarySyncTimer) clearInterval(secondarySyncTimer);
  secondarySyncTimer = null;
}
