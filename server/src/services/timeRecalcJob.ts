import { Op } from 'sequelize';
import { TimeEntry } from '../models/TimeEntry';
import { WorkDay } from '../models/WorkDay';
import { User } from '../models/User';
import { CorrectionRequest } from '../models/CorrectionRequest';
import { SettingsController } from '../controllers/settings.controller';
import { AuditService } from './auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
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
        const [h, m] = String(settings.autoCapTime || '23:00').split(':').map(Number);
        let capAt = localDayStart(shiftDay);
        capAt.setHours(h || 23, m || 0, 0, 0);
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
export async function runRetentionCleanup(now: Date = new Date()): Promise<RetentionResult> {
  const settings = await settingsController.getOrCreateSettings(null);
  const { entriesBefore, gpsBefore, entriesBeforeYmd } = retentionCutoffs(
    now,
    settings.retentionMonthsEntries ?? 24,
    settings.retentionMonthsGps ?? 3
  );

  // (b zuerst) Abgelaufene Zeitdaten löschen (nur ganze Monate vor entriesBefore) —
  // vor der GPS-Nullung, damit gleich zu löschende Zeilen nicht mitgezählt werden.
  const entriesDeleted = await TimeEntry.destroy({ where: { timestamp: { [Op.lt]: entriesBefore } } });

  // (a) GPS-Daten der verbleibenden alten Einträge nullen.
  const [gpsCleared] = await TimeEntry.update(
    { lat: null, lng: null, accuracy: null },
    {
      where: {
        timestamp: { [Op.lt]: gpsBefore },
        [Op.or]: [
          { lat: { [Op.ne]: null } },
          { lng: { [Op.ne]: null } },
          { accuracy: { [Op.ne]: null } },
        ],
      } as any,
    }
  );
  const workDaysDeleted = await WorkDay.destroy({ where: { date: { [Op.lt]: entriesBeforeYmd } } });
  // "Abgelaufen" = bereits entschieden; offene (pending) Anträge bleiben bestehen.
  const correctionsDeleted = await CorrectionRequest.destroy({
    where: { date: { [Op.lt]: entriesBeforeYmd }, status: { [Op.ne]: 'pending' } },
  });

  const result: RetentionResult = { gpsCleared, entriesDeleted, workDaysDeleted, correctionsDeleted };

  if (gpsCleared + entriesDeleted + workDaysDeleted + correctionsDeleted > 0) {
    await AuditService.log({
      action: AuditAction.CLEANUP,
      category: AuditCategory.SYSTEM,
      entity: 'Retention',
      additionalData: {
        ...result,
        entriesCutoff: entriesBeforeYmd,
        gpsCutoff: ymdLocal(gpsBefore),
        retentionMonthsEntries: settings.retentionMonthsEntries ?? 24,
        retentionMonthsGps: settings.retentionMonthsGps ?? 3,
      },
    });
    console.log(
      `Retention: gpsCleared=${gpsCleared}, entriesDeleted=${entriesDeleted}, ` +
      `workDaysDeleted=${workDaysDeleted}, correctionsDeleted=${correctionsDeleted} ` +
      `(Grenzen: Einträge < ${entriesBeforeYmd}, GPS < ${ymdLocal(gpsBefore)}).`
    );
  }
  return result;
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
