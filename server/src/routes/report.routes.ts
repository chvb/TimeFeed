import { Router, Request, Response, NextFunction } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { getManagedCompanyIds } from '../services/accessScope';
import { sendPeriodReport, REPORT_PERIODS, ReportPeriod } from '../services/reportMailService';

/**
 * Berichts-Mails (periodische Berichte, services/reportMailService.ts):
 *   POST /api/reports/send-test {period, companyId?}
 * admin/buchhaltung; Firmen-Reichweite wie bei den Exporten
 * (getManagedCompanyIds). Sendet den Bericht der jeweils letzten abgelaufenen
 * Periode SOFORT an die konfigurierten Empfänger — OHNE den
 * Doppelversand-Merker (reportLastSent) zu setzen.
 * Antwort: {sent:true, recipients:N} bzw. {sent:false, reason:'SMTP_INACTIVE'|…}
 * (bewusst HTTP 200, kein 500 — die UI zeigt den Grund als Toast).
 */

const router = Router();
router.use(authenticate);
router.use(authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG));

router.post('/send-test', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const period = String(req.body?.period || '').trim();
    if (!REPORT_PERIODS.includes(period as ReportPeriod)) {
      throw new AppError(400, `period muss eines von ${REPORT_PERIODS.join('|')} sein`);
    }

    // Eigene Firma oder companyId aus dem Body (Super-/Tenant-Admin), geprüft
    // gegen die verwaltbaren Firmen (accessScope wie bei den Exporten).
    const raw = req.user!.companyId
      ?? (req.body?.companyId != null && req.body.companyId !== '' ? Number(req.body.companyId) : null);
    if (!raw || !Number.isFinite(raw)) {
      throw new AppError(400, 'companyId ist erforderlich');
    }
    const managed = await getManagedCompanyIds(req.user!);
    if (managed !== null && !managed.includes(raw)) {
      throw new AppError(403, 'Kein Zugriff auf diese Firma');
    }

    const result = await sendPeriodReport(raw, period as ReportPeriod, new Date(), { updateLastSent: false });
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
