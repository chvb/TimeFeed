import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { CorrectionRequest, ProposedEntry } from '../models/CorrectionRequest';
import { TimeEntry, TimeEntryType } from '../models/TimeEntry';
import { User, UserRole } from '../models/User';
import { EmailSettings } from '../models/EmailSettings';
import { AppError } from '../middleware/errorHandler';
import { canActorAccessUser, getAccessibleUserIds } from '../services/accessScope';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import emailService, { escapeHtml, renderBrandedEmail } from '../services/emailService';
import { getPublicBaseUrl } from '../utils/baseUrl';
import { addDays, calcWorkDay, localDayStart, ymdLocal } from '../services/timeCalcService';
import { isDayLocked, MONTH_LOCKED_RESPONSE } from '../services/monthLockService';
import { notifyUser } from '../services/pushService';

/**
 * CorrectionController — Korrekturanträge (/api/corrections, Phase 4).
 *
 * Mitarbeiter beantragen für einen Tag Soll-Stempelungen (proposedEntries);
 * admin/buchhaltung/verwaltung entscheiden. Genehmigung erzeugt 'manual'-
 * TimeEntries (createdById = Genehmiger) + Recalc. E-Mails nur wenn SMTP
 * konfiguriert/aktiv ist — Versandfehler werden geschluckt.
 */

const STAMP_TYPES: TimeEntryType[] = ['in', 'out', 'break_start', 'break_end'];
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const MANAGE_ROLES = new Set<string>([UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG]);
const isManager = (req: Request): boolean => MANAGE_ROLES.has(req.user!.role) || !!req.user!.isSuperAdmin;

/** proposedEntries validieren → normalisiertes Array oder Fehlermeldung. */
function parseProposedEntries(raw: any): { entries?: ProposedEntry[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'proposedEntries muss ein nicht-leeres Array [{type, time}] sein' };
  }
  if (raw.length > 20) return { error: 'Maximal 20 Stempelungen pro Antrag' };
  const entries: ProposedEntry[] = [];
  for (const e of raw) {
    const type = e?.type;
    const time = typeof e?.time === 'string' ? e.time.trim() : '';
    if (!STAMP_TYPES.includes(type)) return { error: `Ungültiger Stempel-Typ (erlaubt: ${STAMP_TYPES.join(', ')})` };
    if (!TIME_RE.test(time)) return { error: 'time muss das Format HH:MM haben' };
    entries.push({ type, time });
  }
  return { entries };
}

/** E-Mail nur senden, wenn SMTP konfiguriert und aktiv ist; Fehler schlucken. */
async function sendMailSafe(to: string | string[], subject: string, html: string): Promise<void> {
  try {
    const settings = await EmailSettings.findOne();
    if (!settings || !settings.isActive) return;
    const recipients = Array.isArray(to) ? to.filter(Boolean) : to;
    if (!recipients || (Array.isArray(recipients) && recipients.length === 0)) return;
    await emailService.sendEmail(recipients, subject, html);
  } catch (error) {
    console.error('Korrektur-Benachrichtigung konnte nicht gesendet werden:', (error as any)?.message);
  }
}

function entriesHtml(entries: ProposedEntry[]): string {
  return entries.map((e) => `<li>${escapeHtml(e.time)} — ${escapeHtml(e.type)}</li>`).join('');
}

/** Neuer Antrag → Verwalter-Rollen (admin/buchhaltung/verwaltung) der Firma informieren. */
async function notifyManagersOfNewRequest(cr: CorrectionRequest, employee: User): Promise<void> {
  if (cr.companyId == null) return;
  const managers = await User.findAll({
    where: {
      companyId: cr.companyId,
      isActive: true,
      role: { [Op.in]: [UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG] },
      id: { [Op.ne]: employee.id },
    },
    attributes: ['email'],
  });
  const emails = managers.map((m) => m.email).filter(Boolean);
  if (emails.length === 0) return;
  const html = await renderBrandedEmail({
    title: 'Neuer Korrekturantrag',
    bodyHtml: `
      <p><strong>${escapeHtml(employee.firstName)} ${escapeHtml(employee.lastName)}</strong> hat einen Korrekturantrag für den <strong>${escapeHtml(cr.date)}</strong> gestellt.</p>
      <p>${escapeHtml(cr.message)}</p>
      <p>Vorgeschlagene Stempelungen:</p>
      <ul>${entriesHtml(cr.proposedEntries)}</ul>`,
    button: { text: 'Antrag prüfen', url: `${await getPublicBaseUrl()}/manage-times` },
  });
  await sendMailSafe(emails, `TimeFeed: Neuer Korrekturantrag von ${employee.firstName} ${employee.lastName} (${cr.date})`, html);
}

/** Entscheidung → Mitarbeiter informieren. */
async function notifyEmployeeOfDecision(cr: CorrectionRequest, employee: User, approved: boolean): Promise<void> {
  if (!employee.email) return;
  const verdict = approved ? 'genehmigt' : 'abgelehnt';
  const badge = approved
    ? '<span style="display:inline-block;background-color:#dcfce7;color:#166534;padding:4px 14px;border-radius:999px;font-weight:bold;">genehmigt</span>'
    : '<span style="display:inline-block;background-color:#fee2e2;color:#991b1b;padding:4px 14px;border-radius:999px;font-weight:bold;">abgelehnt</span>';
  const html = await renderBrandedEmail({
    title: `Korrekturantrag ${verdict}`,
    bodyHtml: `
      <p style="text-align:center;">${badge}</p>
      <p>Ihr Korrekturantrag für den <strong>${escapeHtml(cr.date)}</strong> wurde <strong>${verdict}</strong>.</p>
      ${cr.decisionNote ? `<p>Anmerkung: ${escapeHtml(cr.decisionNote)}</p>` : ''}
      <p>Vorgeschlagene Stempelungen:</p>
      <ul>${entriesHtml(cr.proposedEntries)}</ul>`,
    button: { text: 'Meine Zeiten öffnen', url: `${await getPublicBaseUrl()}/times` },
  });
  await sendMailSafe(employee.email, `TimeFeed: Korrekturantrag für ${cr.date} ${verdict}`, html);
}

export class CorrectionController {
  /**
   * POST /api/corrections — Mitarbeiter stellt Antrag FÜR SICH SELBST.
   * Body: { date:'YYYY-MM-DD', message, proposedEntries:[{type, time:'HH:MM'}] }
   * 423 MONTH_LOCKED, wenn der Tag gesperrt ist. Antwort: 201 { correction }.
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const date = String(req.body?.date || '').trim();
      const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
      if (!DATE_RE.test(date) || isNaN(localDayStart(date).getTime())) {
        return next(new AppError(400, 'date muss das Format YYYY-MM-DD haben'));
      }
      if (date > ymdLocal(new Date())) {
        return next(new AppError(400, 'Korrekturanträge sind nur für vergangene Tage bzw. heute möglich'));
      }
      if (!message) return next(new AppError(400, 'message (Begründung) ist erforderlich'));
      const parsed = parseProposedEntries(req.body?.proposedEntries);
      if (parsed.error) return next(new AppError(400, parsed.error));

      const user = await User.findByPk(req.user!.id);
      if (!user) return next(new AppError(404, 'User not found'));

      if (await isDayLocked(user.id, user.companyId ?? null, date)) {
        return res.status(423).json(MONTH_LOCKED_RESPONSE);
      }

      const correction = await CorrectionRequest.create({
        userId: user.id,
        companyId: user.companyId ?? null,
        date,
        message,
        proposedEntries: parsed.entries!,
        status: 'pending',
      });

      await AuditService.log({
        userId: user.id,
        action: AuditAction.CREATE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'CorrectionRequest',
        entityId: correction.id,
        newValues: { date, message, proposedEntries: parsed.entries },
      }, req);

      await notifyManagersOfNewRequest(correction, user);

      res.status(201).json({ correction });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/corrections?status=&userId= — Mitarbeiter: eigene Anträge;
   * admin/buchhaltung/verwaltung: Anträge aller erreichbaren Mitarbeiter
   * (accessScope), filterbar nach status und userId. Antwort: { corrections }.
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const where: any = {};

      if (isManager(req)) {
        const ids = await getAccessibleUserIds(req.user!);
        if (ids !== null) where.userId = { [Op.in]: ids };
        if (req.query.userId) {
          const uid = Number(req.query.userId);
          if (!Number.isFinite(uid)) return next(new AppError(400, 'Ungültige userId'));
          if (ids !== null && !ids.includes(uid)) return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
          where.userId = uid;
        }
      } else {
        where.userId = req.user!.id;
      }

      if (req.query.status) {
        const status = String(req.query.status);
        if (!['pending', 'approved', 'rejected'].includes(status)) {
          return next(new AppError(400, 'Ungültiger status (pending|approved|rejected)'));
        }
        where.status = status;
      }

      const corrections = await CorrectionRequest.findAll({
        where,
        include: [
          { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
          { model: User, as: 'decidedBy', attributes: ['id', 'firstName', 'lastName'] },
        ],
        order: [['createdAt', 'DESC']],
        limit: 500,
      });
      res.json({ corrections });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/corrections/:id/approve — Body { note? }.
   * Wendet proposedEntries als 'manual'-TimeEntries an (createdById = Genehmiger),
   * setzt status 'approved', Recalc, Audit, E-Mail. Antwort: { correction, workDay }.
   */
  async approve(req: Request, res: Response, next: NextFunction) {
    try {
      const { correction, employee, errorHandled } = await this.loadPendingForDecision(req, res, next);
      if (errorHandled || !correction || !employee) return;

      if (await isDayLocked(employee.id, employee.companyId ?? null, correction.date)) {
        res.status(423).json(MONTH_LOCKED_RESPONSE);
        return;
      }

      const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim() : null;
      const dayStart = localDayStart(correction.date);
      const decidedAt = new Date();

      // ATOMAR beanspruchen (pending → approved): nur der erste von zwei gleichzeitigen
      // Approves (Doppelklick/zwei Genehmiger) gewinnt. Verhindert doppelte manuelle Einträge.
      const [claimed] = await CorrectionRequest.update(
        { status: 'approved', decidedById: req.user!.id, decidedAt, decisionNote: note },
        { where: { id: correction.id, status: 'pending' } },
      );
      if (!claimed) {
        return next(new AppError(409, 'Dieser Antrag wurde bereits entschieden.'));
      }
      // In-Memory-Objekt für die Antwort auf den neuen Stand bringen (ohne erneutes Save).
      correction.set({ status: 'approved', decidedById: req.user!.id, decidedAt, decisionNote: note });

      for (const p of correction.proposedEntries) {
        const [h, m] = p.time.split(':').map(Number);
        const ts = new Date(dayStart);
        ts.setHours(h, m, 0, 0);
        await TimeEntry.create({
          userId: employee.id,
          companyId: employee.companyId ?? null,
          type: p.type,
          timestamp: ts,
          source: 'manual',
          createdById: req.user!.id,
          note: `Korrekturantrag #${correction.id}`,
        });
      }

      // Betroffene Arbeitstage neu berechnen (Vortag/Folgetag wegen Nachtschicht-Paarung).
      await calcWorkDay(employee.id, ymdLocal(addDays(dayStart, -1)));
      const workDay = await calcWorkDay(employee.id, correction.date);
      await calcWorkDay(employee.id, ymdLocal(addDays(dayStart, 1)));

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'CorrectionRequest',
        entityId: correction.id,
        oldValues: { status: 'pending' },
        newValues: { status: 'approved', decisionNote: note, appliedEntries: correction.proposedEntries, userId: employee.id, date: correction.date },
      }, req);

      await notifyEmployeeOfDecision(correction, employee, true);

      // Web-Push (fire-and-forget): sofortige Benachrichtigung auf dem Gerät.
      notifyUser(employee.id, {
        title: 'Korrekturantrag genehmigt',
        body: `Dein Korrekturantrag für den ${correction.date} wurde genehmigt.`,
        url: '/',
      }).catch(() => { /* unkritisch */ });

      res.json({ correction, workDay });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/corrections/:id/reject — Body { note }. Antwort: { correction }.
   */
  async reject(req: Request, res: Response, next: NextFunction) {
    try {
      const { correction, employee, errorHandled } = await this.loadPendingForDecision(req, res, next);
      if (errorHandled || !correction || !employee) return;

      const note = typeof req.body?.note === 'string' ? req.body.note.trim() : '';
      if (!note) return next(new AppError(400, 'note (Ablehnungsgrund) ist erforderlich'));

      // ATOMAR beanspruchen (pending → rejected): verhindert die Race mit einem gleichzeitigen
      // approve (das Stempel anlegt) — sonst bliebe der Antrag 'rejected', die Stempel aber bestehen.
      const decidedAt = new Date();
      const [claimed] = await CorrectionRequest.update(
        { status: 'rejected', decidedById: req.user!.id, decidedAt, decisionNote: note },
        { where: { id: correction.id, status: 'pending' } },
      );
      if (!claimed) {
        return next(new AppError(409, 'Dieser Antrag wurde bereits entschieden.'));
      }
      correction.set({ status: 'rejected', decidedById: req.user!.id, decidedAt, decisionNote: note });

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'CorrectionRequest',
        entityId: correction.id,
        oldValues: { status: 'pending' },
        newValues: { status: 'rejected', decisionNote: note, userId: employee.id, date: correction.date },
      }, req);

      await notifyEmployeeOfDecision(correction, employee, false);

      // Web-Push (fire-and-forget): sofortige Benachrichtigung auf dem Gerät.
      notifyUser(employee.id, {
        title: 'Korrekturantrag abgelehnt',
        body: `Dein Korrekturantrag für den ${correction.date} wurde abgelehnt.`,
        url: '/',
      }).catch(() => { /* unkritisch */ });

      res.json({ correction });
    } catch (error) {
      next(error);
    }
  }

  /** Gemeinsame Lade-/Berechtigungslogik für approve/reject. */
  private async loadPendingForDecision(req: Request, res: Response, next: NextFunction):
    Promise<{ correction?: CorrectionRequest; employee?: User; errorHandled: boolean }> {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) { next(new AppError(400, 'Ungültige Antrags-ID')); return { errorHandled: true }; }

    const correction = await CorrectionRequest.findByPk(id);
    if (!correction) { next(new AppError(404, 'Korrekturantrag nicht gefunden')); return { errorHandled: true }; }
    if (correction.status !== 'pending') {
      res.status(409).json({ error: 'ALREADY_DECIDED', code: 'ALREADY_DECIDED', message: 'Antrag wurde bereits entschieden.' });
      return { errorHandled: true };
    }
    if (!(await canActorAccessUser(req.user!, correction.userId))) {
      next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      return { errorHandled: true };
    }
    const employee = await User.findByPk(correction.userId);
    if (!employee) { next(new AppError(404, 'Mitarbeiter nicht gefunden')); return { errorHandled: true }; }
    return { correction, employee, errorHandled: false };
  }
}
