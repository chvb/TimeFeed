import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';
import { TimesheetDocument } from '../models/TimesheetDocument';
import { User } from '../models/User';
import { Company } from '../models/Company';
import { AppError } from '../middleware/errorHandler';
import { canActorAccessUser, getAccessibleUserIds } from '../services/accessScope';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import storageService from '../services/storageService';
import { monthEndDate } from '../services/monthLockService';

/**
 * TimesheetController — Stundenzettel-Uploads (/api/timesheets, Phase 4).
 *
 * PDF/JPG/PNG/WebP bis 10 MB (multer memoryStorage in der Route). Ablage:
 * S3 (wenn storageService aktiv) unter
 * `{attachmentPrefix}tenant-{tid}/company-{cid}/timesheets/{random}.{ext}`,
 * sonst lokal unter server/uploads/timesheets/.
 */

export const TIMESHEET_MIME_EXT: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

// Lokales Upload-Verzeichnis: <server>/uploads/timesheets (funktioniert aus src/ und dist/).
const LOCAL_DIR = path.join(__dirname, '../../uploads/timesheets');

function localPathFor(storageKey: string): string {
  // Nur der Dateiname wird gespeichert — path.basename verhindert Traversal.
  return path.join(LOCAL_DIR, path.basename(storageKey));
}

export class TimesheetController {
  /**
   * POST /api/timesheets — multipart/form-data: file + { userId, periodStart,
   * periodEnd, note? }. Antwort: 201 { document }.
   */
  async upload(req: Request, res: Response, next: NextFunction) {
    try {
      const file = req.file;
      if (!file || !file.buffer) return next(new AppError(400, 'Datei fehlt (Feld "file")'));
      const ext = TIMESHEET_MIME_EXT[file.mimetype];
      if (!ext) return next(new AppError(400, 'Nur PDF, JPG, PNG oder WebP erlaubt'));

      const userId = Number(req.body?.userId);
      const periodStart = String(req.body?.periodStart || '').trim();
      const periodEnd = String(req.body?.periodEnd || '').trim();
      const note = typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note.trim() : null;

      if (!Number.isFinite(userId) || userId <= 0) return next(new AppError(400, 'userId ist erforderlich'));
      if (!DATE_RE.test(periodStart) || !DATE_RE.test(periodEnd)) {
        return next(new AppError(400, 'periodStart/periodEnd müssen das Format YYYY-MM-DD haben'));
      }
      if (periodEnd < periodStart) return next(new AppError(400, 'periodEnd darf nicht vor periodStart liegen'));

      if (!(await canActorAccessUser(req.user!, userId))) {
        return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      }
      const user = await User.findByPk(userId, { attributes: ['id', 'companyId'] });
      if (!user) return next(new AppError(404, 'Mitarbeiter nicht gefunden'));

      const random = crypto.randomBytes(12).toString('hex');
      let storageType: 'local' | 's3';
      let storageKey: string;

      if (await storageService.isActive()) {
        const settings = await storageService.getSettings();
        let prefix = (settings?.s3AttachmentPrefix || 'timefeed/attachments/').replace(/^\/+/, '').replace(/\.\./g, '');
        if (prefix && !prefix.endsWith('/')) prefix += '/';
        const company = user.companyId ? await Company.findByPk(user.companyId, { attributes: ['id', 'tenantId'] }) : null;
        storageKey = `${prefix}tenant-${company?.tenantId ?? 0}/company-${user.companyId ?? 0}/timesheets/${random}.${ext}`;
        await storageService.uploadFile(storageKey, file.buffer, file.mimetype);
        storageType = 's3';
      } else {
        fs.mkdirSync(LOCAL_DIR, { recursive: true });
        storageKey = `${random}.${ext}`;
        fs.writeFileSync(localPathFor(storageKey), file.buffer);
        storageType = 'local';
      }

      const document = await TimesheetDocument.create({
        companyId: user.companyId ?? null,
        userId,
        periodStart,
        periodEnd,
        fileName: file.originalname || `stundenzettel.${ext}`,
        mimeType: file.mimetype,
        size: file.size,
        storageType,
        storageKey,
        uploadedById: req.user!.id,
        note,
      });

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'TimesheetDocument',
        entityId: document.id,
        newValues: { userId, periodStart, periodEnd, fileName: document.fileName, storageType, size: file.size },
      }, req);

      res.status(201).json({ document });
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/timesheets?userId=&month=YYYY-MM — Liste im accessScope. Antwort: { documents }. */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const where: any = {};
      const ids = await getAccessibleUserIds(req.user!);
      if (ids !== null) where.userId = { [Op.in]: ids };

      if (req.query.userId) {
        const uid = Number(req.query.userId);
        if (!Number.isFinite(uid)) return next(new AppError(400, 'Ungültige userId'));
        if (ids !== null && !ids.includes(uid)) return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
        where.userId = uid;
      }

      if (req.query.month) {
        const month = String(req.query.month);
        if (!MONTH_RE.test(month)) return next(new AppError(400, 'month muss das Format YYYY-MM haben'));
        // Überlappung: Zeitraum schneidet den Monat.
        where.periodStart = { [Op.lte]: monthEndDate(month) };
        where.periodEnd = { [Op.gte]: `${month}-01` };
      }

      const documents = await TimesheetDocument.findAll({
        where,
        include: [
          { model: User, as: 'user', attributes: ['id', 'firstName', 'lastName'] },
          { model: User, as: 'uploadedBy', attributes: ['id', 'firstName', 'lastName'] },
        ],
        order: [['periodStart', 'DESC'], ['id', 'DESC']],
        limit: 500,
      });
      res.json({ documents });
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/timesheets/:id/download — Stream mit korrekten Headern. */
  async download(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return next(new AppError(400, 'Ungültige Dokument-ID'));
      const document = await TimesheetDocument.findByPk(id);
      if (!document) return next(new AppError(404, 'Dokument nicht gefunden'));
      if (!(await canActorAccessUser(req.user!, document.userId))) {
        return next(new AppError(403, 'Kein Zugriff auf dieses Dokument'));
      }

      const safeName = document.fileName.replace(/[^\w.\- ]+/g, '_');
      res.setHeader('Content-Type', document.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(document.fileName)}`);

      if (document.storageType === 's3') {
        const buffer = await storageService.downloadFileBuffer(document.storageKey);
        res.setHeader('Content-Length', String(buffer.length));
        return res.end(buffer);
      }

      const filePath = localPathFor(document.storageKey);
      if (!fs.existsSync(filePath)) return next(new AppError(404, 'Datei nicht mehr vorhanden'));
      res.setHeader('Content-Length', String(fs.statSync(filePath).size));
      const stream = fs.createReadStream(filePath);
      stream.on('error', (e) => next(e));
      return stream.pipe(res);
    } catch (error) {
      return next(error);
    }
  }

  /**
   * DELETE /api/timesheets/:id — nur admin/buchhaltung (Route). Hartes Löschen
   * inkl. Storage-Objekt; Audit-Log dokumentiert es. Antwort: { deleted: true }.
   */
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return next(new AppError(400, 'Ungültige Dokument-ID'));
      const document = await TimesheetDocument.findByPk(id);
      if (!document) return next(new AppError(404, 'Dokument nicht gefunden'));
      if (!(await canActorAccessUser(req.user!, document.userId))) {
        return next(new AppError(403, 'Kein Zugriff auf dieses Dokument'));
      }

      // Storage-Objekt entfernen; Fehler (z. B. bereits gelöscht) blockieren
      // das DB-Löschen nicht, werden aber protokolliert.
      try {
        if (document.storageType === 's3') {
          await storageService.deleteFile(document.storageKey);
        } else {
          const filePath = localPathFor(document.storageKey);
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
      } catch (e) {
        console.error('Stundenzettel-Datei konnte nicht gelöscht werden:', (e as any)?.message);
      }

      const old = {
        userId: document.userId,
        periodStart: document.periodStart,
        periodEnd: document.periodEnd,
        fileName: document.fileName,
        storageType: document.storageType,
        storageKey: document.storageKey,
      };
      await document.destroy();

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'TimesheetDocument',
        entityId: id,
        oldValues: old,
      }, req);

      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  }
}
