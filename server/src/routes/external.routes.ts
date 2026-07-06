import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { Op, literal } from 'sequelize';
import dayjs from 'dayjs';
import { apiKeyAuth } from '../middleware/apiKeyAuth';
import { API_SCOPE_TIMES_READ } from '../models/ApiKey';
import { User } from '../models/User';
import { WorkDay } from '../models/WorkDay';
import { AppError } from '../middleware/errorHandler';

// Externe API (z. B. für die Schwester-App UrlaubsFeed): KEIN JWT, Authentifizierung
// ausschließlich über API-Schlüssel (Header `X-Api-Key`, siehe middleware/apiKeyAuth).
// Alle Daten sind strikt auf den Mandanten des Schlüssels gescopet.
const router = Router();

// Eigener, strengerer Rate-Limiter für die externe API (zusätzlich zum globalen /api-Limiter).
const externalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
router.use(externalLimiter);

// Verbindungs-/Schlüsseltest: prüft den Key und nennt den Mandanten.
router.get('/ping', apiKeyAuth(), (req: Request, res: Response) => {
  res.json({ ok: true, tenant: req.apiTenantName });
});

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * GET /api/external/times?from=YYYY-MM-DD&to=YYYY-MM-DD  (Scope: times:read)
 * Liefert die WorkDay-Tagessummen aller Nutzer des Mandanten im Zeitraum:
 * email, employeeNumber, date, workedMinutes, targetMinutes, balanceMinutes,
 * status, absence. Zeitraum: Pflicht, max. 12 Monate.
 */
router.get('/times', apiKeyAuth(API_SCOPE_TIMES_READ), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const from = String(req.query.from || '');
    const to = String(req.query.to || '');
    if (!DATE_RE.test(from) || !DATE_RE.test(to)) {
      throw new AppError(400, 'Parameter from/to erforderlich (Format YYYY-MM-DD).');
    }
    const fromDay = dayjs(from, 'YYYY-MM-DD');
    const toDay = dayjs(to, 'YYYY-MM-DD');
    if (!fromDay.isValid() || !toDay.isValid()) {
      throw new AppError(400, 'Ungültiges Datum in from/to.');
    }
    if (toDay.isBefore(fromDay)) {
      throw new AppError(400, 'to darf nicht vor from liegen.');
    }
    if (toDay.diff(fromDay, 'month', true) > 12) {
      throw new AppError(400, 'Zeitraum darf maximal 12 Monate umfassen.');
    }

    // Nutzer des Mandanten: über die Firmen des Tenants ODER direkt am Tenant hängend.
    const tenantId = Number(req.apiTenantId);
    const users = await User.findAll({
      where: {
        [Op.or]: [
          { companyId: { [Op.in]: literal(`(SELECT id FROM companies WHERE tenant_id = ${tenantId})`) } },
          { tenantId },
        ],
      },
      attributes: ['id', 'email', 'employeeNumber'],
    });
    const userById = new Map<number, { email: string; employeeNumber: string | null }>();
    users.forEach((u) => userById.set(u.id, { email: u.email, employeeNumber: u.employeeNumber || null }));
    const userIds = [...userById.keys()];

    type TimesDto = {
      email: string;
      employeeNumber: string | null;
      date: string;
      workedMinutes: number;
      targetMinutes: number;
      balanceMinutes: number;
      status: string;
      absence: string | null;
    };
    const times: TimesDto[] = [];

    if (userIds.length > 0) {
      const workDays = await WorkDay.findAll({
        where: {
          userId: { [Op.in]: userIds },
          date: { [Op.gte]: from, [Op.lte]: to },
        },
        attributes: ['userId', 'date', 'workedMinutes', 'targetMinutes', 'balanceMinutes', 'status', 'absence'],
        order: [['date', 'ASC'], ['userId', 'ASC']],
      });
      for (const wd of workDays) {
        const user = userById.get(wd.userId)!;
        times.push({
          email: user.email,
          employeeNumber: user.employeeNumber,
          date: wd.date,
          workedMinutes: wd.workedMinutes,
          targetMinutes: wd.targetMinutes,
          balanceMinutes: wd.balanceMinutes,
          status: wd.status,
          absence: wd.absence ?? null,
        });
      }
    }

    res.json({ times });
  } catch (e) { next(e); }
});

export default router;
