import { Op } from 'sequelize';
import { TimeEntry } from '../models/TimeEntry';
import { WorkDay } from '../models/WorkDay';
import { User } from '../models/User';
import { SettingsController } from '../controllers/settings.controller';
import { calcWorkDay, pairShifts, ymdLocal, localDayStart, addDays } from './timeCalcService';

/**
 * Täglicher Zeit-Abschlussjob (02:00 Uhr):
 * 1. Auto-Kappung: Vortage mit offenem 'in' (Ausstempeln vergessen) erhalten —
 *    wenn autoCapEnabled — ein 'out' mit source='auto_cap' zur autoCapTime des
 *    jeweiligen Arbeitstags; der Tag wird danach neu berechnet (Flag 'auto_capped').
 * 2. Alle WorkDays der letzten 3 Tage werden neu berechnet (Nachzügler-Stempel,
 *    geänderte Einstellungen, Feiertags-Updates).
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

let recalcTimer: NodeJS.Timeout | null = null;

/** Startet den täglichen Job um 02:00 (lokale Serverzeit). */
export function startTimeRecalcJob(): void {
  const schedule = () => {
    const now = new Date();
    const next = new Date(now);
    next.setHours(2, 0, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    recalcTimer = setTimeout(async () => {
      await runTimeRecalc();
      schedule(); // nächsten Lauf planen (robust gegen DST-Wechsel)
    }, next.getTime() - now.getTime());
    // Der Timer soll einen Shutdown nicht blockieren.
    if (recalcTimer.unref) recalcTimer.unref();
  };
  schedule();
  console.log('TimeRecalc-Job geplant (täglich 02:00).');
}

export function stopTimeRecalcJob(): void {
  if (recalcTimer) clearTimeout(recalcTimer);
  recalcTimer = null;
}
