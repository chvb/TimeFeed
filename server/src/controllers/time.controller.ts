import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { TimeEntry, TimeEntryType } from '../models/TimeEntry';
import { WorkDay } from '../models/WorkDay';
import { User, UserRole } from '../models/User';
import { Group } from '../models/Group';
import { MonthClosure, MonthClosureTotals } from '../models/MonthClosure';
import { CorrectionRequest } from '../models/CorrectionRequest';
import { AppError } from '../middleware/errorHandler';
import { canActorAccessUser, getAccessibleUserIds, getManagedCompanyIds } from '../services/accessScope';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import { SettingsController } from '../controllers/settings.controller';
import {
  addDays,
  calcWorkDay,
  getUserTimeState,
  localDayStart,
  pairShifts,
  validateStampSequence,
  ymdLocal,
} from '../services/timeCalcService';
import { isDayLocked, isMonthClosed, monthEndDate, monthOf, MONTH_LOCKED_RESPONSE } from '../services/monthLockService';

const settingsController = new SettingsController();

const STAMP_TYPES: TimeEntryType[] = ['in', 'out', 'break_start', 'break_end'];

// Nachbuchungen: maximal so viele Tage rückwirkend.
const MANUAL_MAX_AGE_DAYS = 92;

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Alle Kalendertage eines Monats (YYYY-MM-DD), optional gedeckelt auf heute. */
function daysOfMonth(month: string, capToToday = true): string[] {
  const today = ymdLocal(new Date());
  const days: string[] = [];
  let d = localDayStart(`${month}-01`);
  while (ymdLocal(d).startsWith(month)) {
    const ymd = ymdLocal(d);
    if (capToToday && ymd > today) break;
    days.push(ymd);
    d = addDays(d, 1);
  }
  return days;
}

/**
 * Nach Nachbuchung/Storno/Korrektur die betroffenen ARBEITSTAGE neu berechnen:
 * der Kalendertag selbst plus Vor-/Folgetag (Nachtschicht-Paarung kann sich
 * über die Tagesgrenze hinweg ändern).
 */
async function recalcAround(userId: number, date: string): Promise<WorkDay | null> {
  const day = localDayStart(date);
  await calcWorkDay(userId, ymdLocal(addDays(day, -1)));
  const wd = await calcWorkDay(userId, date);
  await calcWorkDay(userId, ymdLocal(addDays(day, 1)));
  return wd;
}

// Rollen, die Zeiten FREMDER (erreichbarer) Mitarbeiter sehen dürfen; die
// eigentliche Reichweite (Firma/Gruppe) prüft canActorAccessUser (accessScope).
const CAN_VIEW_OTHERS = new Set<string>([UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG]);

/** Ziel-User auflösen: eigene Daten immer; fremde nur admin/buchhaltung/verwaltung im Scope. */
async function resolveTargetUserId(req: Request): Promise<number> {
  const requested = req.query.userId ? Number(req.query.userId) : req.user!.id;
  if (!Number.isFinite(requested)) throw new AppError(400, 'Ungültige userId');
  if (requested === req.user!.id) return requested;
  if (!CAN_VIEW_OTHERS.has(req.user!.role) && !req.user!.isSuperAdmin) {
    throw new AppError(403, 'Keine Berechtigung für fremde Zeitdaten');
  }
  if (!(await canActorAccessUser(req.user!, requested))) {
    throw new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter');
  }
  return requested;
}

/**
 * Einheitliches Status-Objekt (Client-Contract, GENAU diese Form):
 * { state: 'out'|'in'|'break', since: ISO|null, today: WorkDay|null,
 *   breakMode: 'auto'|'manual'|'combined', balanceMinutes: number }
 * balanceMinutes = kumulierter Saldo bis einschließlich gestern.
 */
async function buildTimeStatus(userId: number, companyId: number | null) {
  const settings = await settingsController.getOrCreateSettings(companyId);
  const st = await getUserTimeState(userId);
  // Laufende Nachtschicht: „heutiger" Arbeitstag = Tag des Schichtbeginns.
  const day = st.shiftStartedAt ? ymdLocal(st.shiftStartedAt) : ymdLocal(new Date());
  const today = await WorkDay.findOne({ where: { userId, date: day } });
  const yesterday = ymdLocal(new Date(Date.now() - 24 * 3600 * 1000));
  const total = await WorkDay.sum('balanceMinutes', { where: { userId, date: { [Op.lte]: yesterday } } });
  return {
    state: st.state,
    since: st.since,
    today,
    breakMode: settings.breakMode,
    balanceMinutes: Number(total) || 0,
  };
}

export class TimeController {
  /**
   * POST /api/time/stamp — stempelt für den eingeloggten User mit SERVER-Zeit.
   * Body: { type, lat?, lng?, accuracy?, note? }
   * Sequenzvalidierung → 409 mit Fehlercode (ALREADY_IN, NOT_IN, BREAK_OPEN, NO_BREAK).
   * Antwort: Status-Objekt (siehe buildTimeStatus) NACH der Stempelung.
   */
  async stamp(req: Request, res: Response, next: NextFunction) {
    try {
      const { type, lat, lng, accuracy, note } = req.body || {};
      if (!STAMP_TYPES.includes(type)) {
        return next(new AppError(400, `Ungültiger Stempel-Typ (erlaubt: ${STAMP_TYPES.join(', ')})`));
      }

      const userId = req.user!.id;
      const user = await User.findByPk(userId, { attributes: ['id', 'companyId'] });
      if (!user) return next(new AppError(404, 'User not found'));

      const settings = await settingsController.getOrCreateSettings(user.companyId ?? null);
      const hasGps = lat != null && lng != null;
      if (settings.gpsRequired && !hasGps) {
        return res.status(400).json({ error: 'GPS_REQUIRED', message: 'Standortfreigabe ist für das Stempeln erforderlich.' });
      }

      // Sequenzvalidierung gegen den aktuellen Zustand (gemeinsame Logik mit dem
      // Terminal-Stempeln, siehe timeCalcService.validateStampSequence).
      const state = await getUserTimeState(userId);
      const conflict = validateStampSequence(state.state, type as TimeEntryType);
      if (conflict) {
        return res.status(409).json({ error: conflict.code, code: conflict.code, message: conflict.message });
      }

      const now = new Date();

      // Zieltag = Arbeitstag, den dieser Stempel betrifft (Nachtschicht: Tag des
      // Schichtbeginns). Liegt er in einem ABGESCHLOSSENEN Monat → 423; normale
      // Stempel auf heute bleiben unberührt, solange der Monat offen ist.
      const shiftDay = type === 'in' || !state.shiftStartedAt ? ymdLocal(now) : ymdLocal(state.shiftStartedAt);
      if (await isMonthClosed(userId, user.companyId ?? null, monthOf(shiftDay))) {
        return res.status(423).json(MONTH_LOCKED_RESPONSE);
      }

      // Selbst-Stempelung über die Web-App; 'api' nur für System-Kopplungen
      // (dann mit Auditlog). 'manual' (Nachbuchung) läuft über POST /api/time/manual.
      const source: 'web' | 'api' = req.body.source === 'api' ? 'api' : 'web';

      const entry = await TimeEntry.create({
        userId,
        companyId: user.companyId ?? null,
        type,
        timestamp: now,
        source,
        lat: hasGps ? Number(lat) : null,
        lng: hasGps ? Number(lng) : null,
        accuracy: accuracy != null ? Number(accuracy) : null,
        note: typeof note === 'string' && note.trim() ? note.trim() : null,
      });

      // Betroffenen ARBEITSTAG neu berechnen: bei 'in' der heutige Kalendertag,
      // sonst der Tag des zugehörigen Schichtbeginns (Nachtschicht!).
      await calcWorkDay(userId, shiftDay);

      // Auditlog nur für manuelle/API-Buchungen (normale Selbst-Stempelungen
      // nicht — Datenmenge).
      if (source !== 'web') {
        await AuditService.log({
          userId: req.user!.id,
          action: AuditAction.CREATE,
          category: AuditCategory.DATA_MANAGEMENT,
          entity: 'TimeEntry',
          entityId: entry.id,
          newValues: { type, timestamp: now.toISOString(), source },
        }, req);
      }

      res.status(201).json(await buildTimeStatus(userId, user.companyId ?? null));
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/time/status — aktueller Zustand + heutiger WorkDay + Saldo. */
  async status(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = req.user!.id;
      res.json(await buildTimeStatus(userId, req.user!.companyId ?? null));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/time/entries?userId=&from=&to= — Stempel-Journal.
   * Stornierte Einträge sind enthalten (isCancelled kennzeichnet sie).
   */
  async entries(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = await resolveTargetUserId(req);
      const where: any = { userId };
      const from = req.query.from ? new Date(String(req.query.from)) : null;
      const to = req.query.to ? new Date(String(req.query.to)) : null;
      if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
        return next(new AppError(400, 'Ungültiges from/to-Datum'));
      }
      if (from || to) {
        where.timestamp = {
          ...(from ? { [Op.gte]: from } : {}),
          ...(to ? { [Op.lte]: to } : {}),
        };
      }
      const entries = await TimeEntry.findAll({
        where,
        order: [['timestamp', 'ASC']],
        limit: 2000,
      });
      res.json({ entries });
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/time/days?userId=&month=YYYY-MM — WorkDays + Monatssummen. */
  async days(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = await resolveTargetUserId(req);
      const month = String(req.query.month || '').trim() || ymdLocal(new Date()).slice(0, 7);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
        return next(new AppError(400, 'month muss das Format YYYY-MM haben'));
      }
      const days = await WorkDay.findAll({
        where: { userId, date: { [Op.gte]: `${month}-01`, [Op.lte]: monthEndDate(month) } },
        order: [['date', 'ASC']],
      });
      const summary = days.reduce(
        (acc, d) => {
          acc.targetMinutes += d.targetMinutes;
          acc.workedMinutes += d.workedMinutes;
          acc.balanceMinutes += d.balanceMinutes;
          return acc;
        },
        { targetMinutes: 0, workedMinutes: 0, balanceMinutes: 0 }
      );
      res.json({ month, days, summary });
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/time/balance?userId= — kumulierter Saldo (bis einschließlich gestern). */
  async balance(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = await resolveTargetUserId(req);
      const yesterday = ymdLocal(new Date(Date.now() - 24 * 3600 * 1000));
      const total = await WorkDay.sum('balanceMinutes', {
        where: { userId, date: { [Op.lte]: yesterday } },
      });
      res.json({ userId, upToDate: yesterday, balanceMinutes: Number(total) || 0 });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/time/manual — Nachbuchung (admin/buchhaltung/verwaltung im Scope).
   * Body: { userId, type, timestamp (ISO, Vergangenheit, max. 92 Tage), note? }
   * → TimeEntry source 'manual' (createdById = Actor) + Recalc der betroffenen Tage.
   * 423 MONTH_LOCKED, wenn der Zieltag in einem abgeschlossenen Monat liegt bzw.
   * der WorkDay 'locked' ist. Antwort: 201 { entry, workDay }.
   */
  async manual(req: Request, res: Response, next: NextFunction) {
    try {
      const { userId, type, timestamp, note } = req.body || {};
      const targetUserId = Number(userId);
      if (!Number.isFinite(targetUserId) || targetUserId <= 0) {
        return next(new AppError(400, 'userId ist erforderlich'));
      }
      if (!STAMP_TYPES.includes(type)) {
        return next(new AppError(400, `Ungültiger Stempel-Typ (erlaubt: ${STAMP_TYPES.join(', ')})`));
      }
      const ts = timestamp ? new Date(String(timestamp)) : null;
      if (!ts || isNaN(ts.getTime())) {
        return next(new AppError(400, 'timestamp muss ein gültiger ISO-Zeitpunkt sein'));
      }
      const now = new Date();
      if (ts.getTime() > now.getTime()) {
        return next(new AppError(400, 'timestamp muss in der Vergangenheit liegen'));
      }
      if (now.getTime() - ts.getTime() > MANUAL_MAX_AGE_DAYS * 24 * 3600 * 1000) {
        return next(new AppError(400, `Nachbuchung maximal ${MANUAL_MAX_AGE_DAYS} Tage rückwirkend möglich`));
      }

      if (!(await canActorAccessUser(req.user!, targetUserId))) {
        return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      }
      const user = await User.findByPk(targetUserId, { attributes: ['id', 'companyId'] });
      if (!user) return next(new AppError(404, 'Mitarbeiter nicht gefunden'));

      const day = ymdLocal(ts);
      if (await isDayLocked(targetUserId, user.companyId ?? null, day)) {
        return res.status(423).json(MONTH_LOCKED_RESPONSE);
      }

      const entry = await TimeEntry.create({
        userId: targetUserId,
        companyId: user.companyId ?? null,
        type,
        timestamp: ts,
        source: 'manual',
        createdById: req.user!.id,
        note: typeof note === 'string' && note.trim() ? note.trim() : null,
      });

      const workDay = await recalcAround(targetUserId, day);

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'TimeEntry',
        entityId: entry.id,
        newValues: { userId: targetUserId, type, timestamp: ts.toISOString(), source: 'manual', note: entry.note },
      }, req);

      res.status(201).json({ entry, workDay });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/time/entries/:id/cancel — Storno (admin/buchhaltung/verwaltung im
   * Scope; Mitarbeiter dürfen auch EIGENE Einträge nicht stornieren — dafür gibt
   * es den Korrekturantrag). Body: { reason }. Antwort: { entry, workDay }.
   */
  async cancelEntry(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (!Number.isFinite(id)) return next(new AppError(400, 'Ungültige Eintrags-ID'));
      if (!reason) return next(new AppError(400, 'reason (Storno-Grund) ist erforderlich'));

      const entry = await TimeEntry.findByPk(id);
      if (!entry) return next(new AppError(404, 'Stempelung nicht gefunden'));
      if (entry.isCancelled) {
        return res.status(409).json({ error: 'ALREADY_CANCELLED', code: 'ALREADY_CANCELLED', message: 'Stempelung ist bereits storniert.' });
      }
      if (!(await canActorAccessUser(req.user!, entry.userId))) {
        return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      }

      const day = ymdLocal(new Date(entry.timestamp));
      if (await isDayLocked(entry.userId, entry.companyId ?? null, day)) {
        return res.status(423).json(MONTH_LOCKED_RESPONSE);
      }

      await entry.update({
        isCancelled: true,
        cancelledById: req.user!.id,
        cancelledAt: new Date(),
        cancelReason: reason,
      });

      const workDay = await recalcAround(entry.userId, day);

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'TimeEntry',
        entityId: entry.id,
        oldValues: { isCancelled: false },
        newValues: { isCancelled: true, cancelReason: reason, userId: entry.userId, type: entry.type, timestamp: entry.timestamp },
      }, req);

      res.json({ entry, workDay });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/time/month-overview?month=YYYY-MM — Übersicht aller erreichbaren
   * Mitarbeiter (admin/buchhaltung/verwaltung, accessScope). Antwort:
   * { month, users: [{ userId, name, targetMinutes, workedMinutes, balanceMinutes,
   *   flaggedDays, incompleteDays, openCorrections, closed }] }
   */
  async monthOverview(req: Request, res: Response, next: NextFunction) {
    try {
      const month = String(req.query.month || '').trim() || ymdLocal(new Date()).slice(0, 7);
      if (!MONTH_RE.test(month)) return next(new AppError(400, 'month muss das Format YYYY-MM haben'));

      const ids = await getAccessibleUserIds(req.user!);
      const userWhere: any = { isActive: true };
      if (ids !== null) userWhere.id = { [Op.in]: ids };
      const users = await User.findAll({
        where: userWhere,
        attributes: ['id', 'firstName', 'lastName', 'companyId'],
        order: [['lastName', 'ASC'], ['firstName', 'ASC']],
      });
      const userIds = users.map((u) => u.id);
      const dateRange = { [Op.gte]: `${month}-01`, [Op.lte]: monthEndDate(month) };

      const [workDays, corrections, closures] = userIds.length === 0
        ? [[], [], []]
        : await Promise.all([
          WorkDay.findAll({ where: { userId: { [Op.in]: userIds }, date: dateRange } }),
          CorrectionRequest.findAll({
            where: { userId: { [Op.in]: userIds }, status: 'pending', date: dateRange },
            attributes: ['userId'],
          }),
          MonthClosure.findAll({ where: { month } }),
        ]);

      const byUser = new Map<number, any>();
      for (const u of users) {
        byUser.set(u.id, {
          userId: u.id,
          name: `${u.firstName} ${u.lastName}`,
          targetMinutes: 0,
          workedMinutes: 0,
          balanceMinutes: 0,
          flaggedDays: 0,
          incompleteDays: 0,
          openCorrections: 0,
          closed: closures.some((c) => c.userId === u.id || (c.userId == null && u.companyId != null && c.companyId === u.companyId)),
        });
      }
      for (const d of workDays as WorkDay[]) {
        const row = byUser.get(d.userId);
        if (!row) continue;
        row.targetMinutes += d.targetMinutes;
        row.workedMinutes += d.workedMinutes;
        row.balanceMinutes += d.balanceMinutes;
        if (d.status === 'flagged') row.flaggedDays += 1;
        if (d.status === 'incomplete') row.incompleteDays += 1;
      }
      for (const c of corrections as CorrectionRequest[]) {
        const row = byUser.get(c.userId);
        if (row) row.openCorrections += 1;
      }

      res.json({ month, users: [...byUser.values()] });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/time/close-month — Monatsabschluss (nur admin/buchhaltung).
   * Body: { month: 'YYYY-MM', userId?, companyId? (nur ohne eigene Firma nötig) }.
   * Ablauf: alle Tage des Monats recalcen → KEINE incomplete-Tage zulassen
   * (400 { code:'INCOMPLETE_DAYS', days:[{userId,date}] }) → WorkDays 'locked'
   * → MonthClosure mit totals-Snapshot. Antwort: 201 { closure }.
   */
  async closeMonth(req: Request, res: Response, next: NextFunction) {
    try {
      const month = String(req.body?.month || '').trim();
      if (!MONTH_RE.test(month)) return next(new AppError(400, 'month muss das Format YYYY-MM haben'));
      if (month > ymdLocal(new Date()).slice(0, 7)) {
        return next(new AppError(400, 'Zukünftige Monate können nicht abgeschlossen werden'));
      }

      const singleUserId = req.body?.userId != null && req.body.userId !== '' ? Number(req.body.userId) : null;
      let companyId: number | null;
      let targets: User[];

      if (singleUserId != null) {
        if (!Number.isFinite(singleUserId)) return next(new AppError(400, 'Ungültige userId'));
        if (!(await canActorAccessUser(req.user!, singleUserId))) {
          return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
        }
        const user = await User.findByPk(singleUserId);
        if (!user) return next(new AppError(404, 'Mitarbeiter nicht gefunden'));
        if (user.companyId == null) return next(new AppError(400, 'Mitarbeiter ist keiner Firma zugeordnet'));
        companyId = user.companyId;
        targets = [user];
      } else {
        companyId = req.user!.companyId ?? (req.body?.companyId != null ? Number(req.body.companyId) : null);
        if (!companyId || !Number.isFinite(companyId)) {
          return next(new AppError(400, 'companyId ist erforderlich (Abschluss der ganzen Firma)'));
        }
        const managed = await getManagedCompanyIds(req.user!);
        if (managed !== null && !managed.includes(companyId)) {
          return next(new AppError(403, 'Kein Zugriff auf diese Firma'));
        }
        targets = await User.findAll({ where: { companyId, isActive: true } });
      }

      // Bereits abgeschlossen? (Einzelabschluss ODER Firmenabschluss deckt ab.)
      for (const u of targets) {
        if (await isMonthClosed(u.id, companyId, month)) {
          return res.status(409).json({ error: 'ALREADY_CLOSED', code: 'ALREADY_CLOSED', message: `Monat ${month} ist bereits abgeschlossen.` });
        }
      }

      // 1) Alle Tage des Monats (bis heute) neu berechnen.
      const days = daysOfMonth(month);
      for (const u of targets) {
        for (const day of days) {
          await calcWorkDay(u.id, day);
        }
      }

      // 2) Keine incomplete-Tage zulassen.
      const targetIds = targets.map((u) => u.id);
      const dateRange = { [Op.gte]: `${month}-01`, [Op.lte]: monthEndDate(month) };
      const incomplete = await WorkDay.findAll({
        where: { userId: { [Op.in]: targetIds }, date: dateRange, status: 'incomplete' },
        attributes: ['userId', 'date'],
        order: [['date', 'ASC']],
      });
      if (incomplete.length > 0) {
        return res.status(400).json({
          error: 'INCOMPLETE_DAYS',
          code: 'INCOMPLETE_DAYS',
          message: 'Der Monat enthält unvollständige Tage (Ausstempeln vergessen) — bitte zuerst korrigieren.',
          days: incomplete.map((d) => ({ userId: d.userId, date: d.date })),
        });
      }

      // 3) Totals-Snapshot bilden, dann WorkDays sperren.
      const workDays = await WorkDay.findAll({ where: { userId: { [Op.in]: targetIds }, date: dateRange } });
      const perUser = targets.map((u) => {
        const rows = workDays.filter((d) => d.userId === u.id);
        return {
          userId: u.id,
          name: `${u.firstName} ${u.lastName}`,
          targetMinutes: rows.reduce((s, d) => s + d.targetMinutes, 0),
          workedMinutes: rows.reduce((s, d) => s + d.workedMinutes, 0),
          balanceMinutes: rows.reduce((s, d) => s + d.balanceMinutes, 0),
        };
      });
      const totals: MonthClosureTotals = {
        targetMinutes: perUser.reduce((s, u) => s + u.targetMinutes, 0),
        workedMinutes: perUser.reduce((s, u) => s + u.workedMinutes, 0),
        balanceMinutes: perUser.reduce((s, u) => s + u.balanceMinutes, 0),
        users: perUser,
      };

      await WorkDay.update(
        { status: 'locked' },
        { where: { userId: { [Op.in]: targetIds }, date: dateRange } }
      );

      const closure = await MonthClosure.create({
        companyId,
        userId: singleUserId,
        month,
        closedById: req.user!.id,
        closedAt: new Date(),
        totals,
      });

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'MonthClosure',
        entityId: closure.id,
        newValues: { companyId, userId: singleUserId, month, totals: { targetMinutes: totals.targetMinutes, workedMinutes: totals.workedMinutes, balanceMinutes: totals.balanceMinutes } },
      }, req);

      res.status(201).json({ closure });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/time/reopen-month — Wiedereröffnung (nur admin).
   * Body: { month, userId?, companyId? }. Löscht die Closure, setzt 'locked'
   * WorkDays auf 'ok' und berechnet den Monat neu. Antwort: { reopened: true, month, userId }.
   */
  async reopenMonth(req: Request, res: Response, next: NextFunction) {
    try {
      const month = String(req.body?.month || '').trim();
      if (!MONTH_RE.test(month)) return next(new AppError(400, 'month muss das Format YYYY-MM haben'));
      const singleUserId = req.body?.userId != null && req.body.userId !== '' ? Number(req.body.userId) : null;

      const where: any = { month, userId: singleUserId };
      if (req.user!.companyId) where.companyId = req.user!.companyId;
      else if (req.body?.companyId != null) where.companyId = Number(req.body.companyId);
      const closure = await MonthClosure.findOne({ where });
      if (!closure) return next(new AppError(404, 'Kein Monatsabschluss gefunden'));

      const managed = await getManagedCompanyIds(req.user!);
      if (managed !== null && !managed.includes(closure.companyId)) {
        return next(new AppError(403, 'Kein Zugriff auf diese Firma'));
      }

      const targetIds = singleUserId != null
        ? [singleUserId]
        : (await User.findAll({ where: { companyId: closure.companyId }, attributes: ['id'] })).map((u) => u.id);

      const oldTotals = closure.totals;
      await closure.destroy();

      const dateRange = { [Op.gte]: `${month}-01`, [Op.lte]: monthEndDate(month) };
      if (targetIds.length > 0) {
        await WorkDay.update(
          { status: 'ok' },
          { where: { userId: { [Op.in]: targetIds }, date: dateRange, status: 'locked' } }
        );
        // Recalc stellt Status/Aggregatwerte wieder korrekt her.
        for (const uid of targetIds) {
          for (const day of daysOfMonth(month)) {
            await calcWorkDay(uid, day);
          }
        }
      }

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'MonthClosure',
        entityId: closure.id,
        oldValues: { companyId: closure.companyId, userId: closure.userId, month, totals: { targetMinutes: oldTotals?.targetMinutes, workedMinutes: oldTotals?.workedMinutes, balanceMinutes: oldTotals?.balanceMinutes } },
      }, req);

      res.json({ reopened: true, month, userId: singleUserId });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/time/presence — Anwesenheitstafel (admin/buchhaltung/verwaltung,
   * accessScope). Antwort: [{ userId, firstName, lastName, groupName,
   * state:'in'|'break'|'out', since }]. Effizient: TimeEntries der letzten 48h
   * werden EINMAL geladen und je User gepaart (keine N+1-Queries).
   */
  async presence(req: Request, res: Response, next: NextFunction) {
    try {
      const ids = await getAccessibleUserIds(req.user!);
      const userWhere: any = { isActive: true };
      if (ids !== null) userWhere.id = { [Op.in]: ids };
      const users = await User.findAll({
        where: userWhere,
        attributes: ['id', 'firstName', 'lastName'],
        include: [{ model: Group, as: 'group', attributes: ['name'], required: false }],
        order: [['lastName', 'ASC'], ['firstName', 'ASC']],
      });
      const userIds = users.map((u) => u.id);

      const now = new Date();
      const entries = userIds.length === 0 ? [] : await TimeEntry.findAll({
        where: {
          userId: { [Op.in]: userIds },
          isCancelled: false,
          timestamp: { [Op.gte]: new Date(now.getTime() - 48 * 3600 * 1000), [Op.lte]: now },
        },
        attributes: ['userId', 'type', 'timestamp', 'lat', 'lng', 'source'],
        order: [['timestamp', 'ASC']],
      });

      // Gebündelte getUserTimeState-Logik: Einträge je User gruppieren + pairShifts.
      const byUser = new Map<number, Array<{ type: TimeEntryType; timestamp: Date; lat?: number | null; lng?: number | null; source?: string }>>();
      for (const e of entries) {
        const list = byUser.get(e.userId) || [];
        list.push({ type: e.type, timestamp: new Date(e.timestamp), lat: e.lat, lng: e.lng, source: e.source });
        byUser.set(e.userId, list);
      }

      const result = users.map((u) => {
        const shifts = pairShifts(byUser.get(u.id) || []);
        const last = shifts.length > 0 ? shifts[shifts.length - 1] : null;
        let state: 'in' | 'break' | 'out' = 'out';
        let since: Date | null = null;
        if (last && !last.outAt) {
          if (last.breakOpenSince) { state = 'break'; since = last.breakOpenSince; }
          else { state = 'in'; since = last.inAt; }
        }
        return {
          userId: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          groupName: (u as any).group?.name ?? null,
          state,
          since,
        };
      });

      res.json(result);
    } catch (error) {
      next(error);
    }
  }
}
