import { Request, Response, NextFunction } from 'express';
import { ExportProfile, EXPORT_FORMATS, PERSONALNR_SOURCES, OVERTIME_MODES } from '../models/ExportProfile';
import { AppError } from '../middleware/errorHandler';
import { getManagedCompanyIds } from '../services/accessScope';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import {
  buildExportFile,
  collectExportData,
  DEFAULT_PROFILE,
  resolveFormat,
} from '../services/exportService';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * companyId des Requests auflösen (eigene Firma oder ?companyId= für
 * Super-/Tenant-Admins) und gegen die verwaltbaren Firmen prüfen.
 */
async function resolveCompanyId(req: Request): Promise<number> {
  const raw = req.user!.companyId ?? (req.query.companyId != null && req.query.companyId !== '' ? Number(req.query.companyId) : null);
  if (!raw || !Number.isFinite(raw)) {
    throw new AppError(400, 'companyId ist erforderlich');
  }
  const managed = await getManagedCompanyIds(req.user!);
  if (managed !== null && !managed.includes(raw)) {
    throw new AppError(403, 'Kein Zugriff auf diese Firma');
  }
  return raw;
}

const profileJson = (companyId: number, p: any) => ({
  companyId,
  format: p.format,
  beraterNr: p.beraterNr || '',
  mandantenNr: p.mandantenNr || '',
  personalNrSource: p.personalNrSource,
  lohnartNormal: p.lohnartNormal,
  lohnartOvertime: p.lohnartOvertime || null,
  overtimeMode: p.overtimeMode,
  exportOnlyClosed: !!p.exportOnlyClosed,
  decimalComma: !!p.decimalComma,
});

export class ExportController {
  /**
   * GET /api/export-profile?companyId= (admin/buchhaltung) — Profil der Firma
   * oder Defaults, falls noch keins gespeichert wurde.
   * Antwort: { profile, exists }.
   */
  async getProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const companyId = await resolveCompanyId(req);
      const existing = await ExportProfile.findOne({ where: { companyId } });
      res.json({
        profile: profileJson(companyId, existing ?? DEFAULT_PROFILE),
        exists: !!existing,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/export-profile?companyId= (admin/buchhaltung) — Profil anlegen/
   * aktualisieren (Upsert; eine Zeile je Firma). Validiert format /
   * personalNrSource / overtimeMode. Antwort: { profile }.
   */
  async updateProfile(req: Request, res: Response, next: NextFunction) {
    try {
      const companyId = await resolveCompanyId(req);
      const b = req.body || {};

      const str = (v: any) => (v == null ? '' : String(v).trim());
      const updates: any = {};

      if (b.format !== undefined) {
        const format = str(b.format).toLowerCase();
        if (!EXPORT_FORMATS.includes(format as any)) {
          return next(new AppError(400, `format muss eines von ${EXPORT_FORMATS.join('|')} sein`));
        }
        updates.format = format;
      }
      if (b.personalNrSource !== undefined) {
        const src = str(b.personalNrSource);
        if (!PERSONALNR_SOURCES.includes(src as any)) {
          return next(new AppError(400, `personalNrSource muss eines von ${PERSONALNR_SOURCES.join('|')} sein`));
        }
        updates.personalNrSource = src;
      }
      if (b.overtimeMode !== undefined) {
        const mode = str(b.overtimeMode);
        if (!OVERTIME_MODES.includes(mode as any)) {
          return next(new AppError(400, `overtimeMode muss eines von ${OVERTIME_MODES.join('|')} sein`));
        }
        updates.overtimeMode = mode;
      }
      if (b.beraterNr !== undefined) updates.beraterNr = str(b.beraterNr);
      if (b.mandantenNr !== undefined) updates.mandantenNr = str(b.mandantenNr);
      if (b.lohnartNormal !== undefined) {
        const lohnart = str(b.lohnartNormal);
        if (!lohnart) return next(new AppError(400, 'lohnartNormal darf nicht leer sein'));
        updates.lohnartNormal = lohnart;
      }
      // lohnartOvertime: leer/null = Überstunden nicht separat exportieren.
      if (b.lohnartOvertime !== undefined) updates.lohnartOvertime = str(b.lohnartOvertime) || null;
      if (b.exportOnlyClosed !== undefined) {
        if (typeof b.exportOnlyClosed !== 'boolean') return next(new AppError(400, 'exportOnlyClosed muss boolean sein'));
        updates.exportOnlyClosed = b.exportOnlyClosed;
      }
      if (b.decimalComma !== undefined) {
        if (typeof b.decimalComma !== 'boolean') return next(new AppError(400, 'decimalComma muss boolean sein'));
        updates.decimalComma = b.decimalComma;
      }

      let profile = await ExportProfile.findOne({ where: { companyId } });
      const oldValues = profile ? profileJson(companyId, profile) : null;
      if (profile) {
        await profile.update(updates);
      } else {
        profile = await ExportProfile.create({ companyId, ...updates });
      }

      await AuditService.log({
        userId: req.user!.id,
        action: oldValues ? AuditAction.UPDATE : AuditAction.CREATE,
        category: AuditCategory.SYSTEM_SETTINGS,
        entity: 'ExportProfile',
        entityId: profile.id,
        oldValues,
        newValues: profileJson(companyId, profile),
      }, req);

      res.json({ profile: profileJson(companyId, profile) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/exports/preview?companyId=&month=YYYY-MM&format= (admin/buchhaltung)
   * — JSON-Vorschau für die UI. Antwort:
   * { month, format, rows:[{personalNr,name,istHours,sollHours,saldoHours,
   *   overtimeHours}], warnings, closedAll }.
   */
  async preview(req: Request, res: Response, next: NextFunction) {
    try {
      const companyId = await resolveCompanyId(req);
      const month = String(req.query.month || '').trim();
      if (!MONTH_RE.test(month)) return next(new AppError(400, 'month muss das Format YYYY-MM haben'));

      const data = await collectExportData(req.user!, companyId, month);
      const format = resolveFormat(data.profile, req.query.format as string | undefined);
      const toH = (m: number) => Math.round((m / 60) * 100) / 100;

      res.json({
        month,
        format,
        rows: data.rows.map((r) => ({
          personalNr: r.personalNr,
          name: r.name,
          istHours: toH(r.istMinutes),
          sollHours: toH(r.sollMinutes),
          saldoHours: toH(r.saldoMinutes),
          overtimeHours: toH(r.overtimeMinutes),
        })),
        warnings: data.warnings,
        closedAll: data.closedAll,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/exports/run?companyId=&month=YYYY-MM&format=&force= (admin/
   * buchhaltung) — liefert die Export-Datei als Download. Format optional
   * (Default aus dem Profil). Bei exportOnlyClosed und nicht (vollständig)
   * abgeschlossenem Monat: 409 { code:'MONTH_NOT_CLOSED', openUsers } —
   * mit force=true übersteuerbar (wird auditiert). Warnungen (z. B. fehlende
   * Personalnummern) als Header X-Export-Warnings (JSON, base64).
   */
  async run(req: Request, res: Response, next: NextFunction) {
    try {
      const companyId = await resolveCompanyId(req);
      const month = String(req.query.month || '').trim();
      if (!MONTH_RE.test(month)) return next(new AppError(400, 'month muss das Format YYYY-MM haben'));
      const force = String(req.query.force || '') === 'true';

      const data = await collectExportData(req.user!, companyId, month);
      const format = resolveFormat(data.profile, req.query.format as string | undefined);

      if (data.profile.exportOnlyClosed && !data.closedAll && !force) {
        return res.status(409).json({
          error: 'MONTH_NOT_CLOSED',
          code: 'MONTH_NOT_CLOSED',
          message: `Der Monat ${month} ist nicht für alle Mitarbeiter abgeschlossen. Erst abschließen oder mit force=true exportieren.`,
          openUsers: data.openUsers,
        });
      }

      const file = await buildExportFile(data, format);

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.EXPORT,
        category: AuditCategory.IMPORT_EXPORT,
        entity: 'ExportProfile',
        additionalData: {
          companyId,
          month,
          format,
          fileName: file.fileName,
          rowCount: data.rows.length,
          warningCount: data.warnings.length,
          closedAll: data.closedAll,
          // force dokumentiert bewusst den Export eines NICHT abgeschlossenen Monats.
          force: force && !data.closedAll,
        },
      }, req);

      res.setHeader('Content-Type', file.contentType);
      res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`);
      res.setHeader('Content-Length', String(file.body.length));
      // Warnungen (JSON→base64, header-safe) für die UI zusätzlich zur Datei.
      res.setHeader('X-Export-Warnings', Buffer.from(JSON.stringify(data.warnings), 'utf8').toString('base64'));
      res.setHeader('Access-Control-Expose-Headers', 'X-Export-Warnings, Content-Disposition');
      return res.end(file.body);
    } catch (error) {
      return next(error);
    }
  }
}
