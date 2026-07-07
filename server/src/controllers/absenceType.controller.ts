import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { AbsenceType, ABSENCE_KEY_RE, ABSENCE_COLOR_PALETTE } from '../models/AbsenceType';
import { WorkDay } from '../models/WorkDay';
import { AppError } from '../middleware/errorHandler';
import { getManagedCompanyIds } from '../services/accessScope';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * Abwesenheitsarten-Katalog (/api/absence-types).
 * Lesen: alle eingeloggten Rollen (Badges/Selects brauchen Labels+Farben).
 * Schreiben: nur admin. Builtin-Arten: nur label/color/datevKennzeichen/isActive
 * änderbar, niemals löschbar; eigene Arten nicht löschbar, solange WorkDays sie
 * referenzieren (409 IN_USE).
 */

/** Sichtbarer Scope des Actors: eigene Firma bzw. ?companyId (geprüft). */
async function resolveCompanyId(req: Request): Promise<number | null> {
  const raw = req.user!.companyId
    ?? (req.query.companyId != null && req.query.companyId !== '' ? Number(req.query.companyId) : null);
  if (raw == null) return null; // Super-/Mandanten-Admin ohne Firmenauswahl → nur globale Vorlagen
  if (!Number.isFinite(raw)) throw new AppError(400, 'Ungültige companyId');
  const managed = await getManagedCompanyIds(req.user!);
  if (managed !== null && !managed.includes(raw)) {
    throw new AppError(403, 'Kein Zugriff auf diese Firma');
  }
  return raw;
}

const typeJson = (t: AbsenceType) => ({
  id: t.id,
  companyId: t.companyId ?? null,
  key: t.key,
  label: t.label,
  color: t.color,
  datevKennzeichen: t.datevKennzeichen,
  isBuiltin: !!t.isBuiltin,
  isActive: !!t.isActive,
  sortOrder: t.sortOrder,
});

export class AbsenceTypeController {
  /**
   * GET /api/absence-types?companyId= — Katalog (globale Vorlagen + Arten der
   * Firma), sortiert. Antwort: { absenceTypes, palette }.
   */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const companyId = await resolveCompanyId(req);
      const scopes: any[] = [{ companyId: null }];
      if (companyId != null) scopes.push({ companyId });
      const types = await AbsenceType.findAll({
        where: { [Op.or]: scopes },
        order: [['sortOrder', 'ASC'], ['label', 'ASC'], ['id', 'ASC']],
      });
      res.json({ absenceTypes: types.map(typeJson), palette: ABSENCE_COLOR_PALETTE });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/absence-types (admin) — neue Art im Scope des Actors anlegen. */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const companyId = await resolveCompanyId(req);
      const b = req.body || {};
      const key = String(b.key || '').trim().toLowerCase();
      const label = String(b.label || '').trim();
      if (!ABSENCE_KEY_RE.test(key)) {
        return next(new AppError(400, 'key muss kebab/snake-case sein (a-z, 0-9, "-", "_")'));
      }
      if (key === 'holiday') {
        return next(new AppError(400, "'holiday' ist als Sonderwert für Feiertage reserviert"));
      }
      if (!label) return next(new AppError(400, 'label ist erforderlich'));
      const color = String(b.color || '').trim() || ABSENCE_COLOR_PALETTE[0];
      if (!HEX_RE.test(color)) return next(new AppError(400, 'color muss eine Hex-Farbe (#rrggbb) sein'));
      const kennzeichen = String(b.datevKennzeichen ?? '1').trim().slice(0, 1) || '1';

      // key eindeutig je Scope: kollidiert weder mit globalen Vorlagen noch
      // mit Arten der eigenen Firma.
      const scopes: any[] = [{ companyId: null }];
      if (companyId != null) scopes.push({ companyId });
      const clash = await AbsenceType.findOne({ where: { key, [Op.or]: scopes } });
      if (clash) {
        return res.status(409).json({ error: 'KEY_EXISTS', code: 'KEY_EXISTS', message: `Eine Abwesenheitsart mit dem Key '${key}' existiert bereits.` });
      }

      const created = await AbsenceType.create({
        companyId,
        key,
        label,
        color,
        datevKennzeichen: kennzeichen,
        isBuiltin: false,
        isActive: b.isActive === undefined ? true : !!b.isActive,
        sortOrder: Number.isFinite(Number(b.sortOrder)) ? Number(b.sortOrder) : 100,
      });

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        category: AuditCategory.SYSTEM_SETTINGS,
        entity: 'AbsenceType',
        entityId: created.id,
        newValues: typeJson(created),
      }, req);

      res.status(201).json({ absenceType: typeJson(created) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * PUT /api/absence-types/:id (admin) — Art bearbeiten. Builtin: nur
   * label/color/datevKennzeichen/isActive (key/sortOrder bleiben fix).
   */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return next(new AppError(400, 'Ungültige ID'));
      const type = await AbsenceType.findByPk(id);
      if (!type) return next(new AppError(404, 'Abwesenheitsart nicht gefunden'));

      // Firmenspezifische Arten nur im eigenen Verwaltungsbereich; globale
      // Vorlagen darf jeder Admin pflegen (Ein-Firmen-Selfhost-Standardfall).
      if (type.companyId != null) {
        const managed = await getManagedCompanyIds(req.user!);
        if (managed !== null && !managed.includes(type.companyId)) {
          return next(new AppError(403, 'Kein Zugriff auf diese Abwesenheitsart'));
        }
      }

      const b = req.body || {};
      const updates: any = {};
      if (b.label !== undefined) {
        const label = String(b.label || '').trim();
        if (!label) return next(new AppError(400, 'label darf nicht leer sein'));
        updates.label = label;
      }
      if (b.color !== undefined) {
        const color = String(b.color || '').trim();
        if (!HEX_RE.test(color)) return next(new AppError(400, 'color muss eine Hex-Farbe (#rrggbb) sein'));
        updates.color = color;
      }
      if (b.datevKennzeichen !== undefined) {
        updates.datevKennzeichen = String(b.datevKennzeichen ?? '1').trim().slice(0, 1) || '1';
      }
      if (b.isActive !== undefined) updates.isActive = !!b.isActive;

      if (!type.isBuiltin) {
        if (b.sortOrder !== undefined && Number.isFinite(Number(b.sortOrder))) updates.sortOrder = Number(b.sortOrder);
        if (b.key !== undefined) {
          const key = String(b.key || '').trim().toLowerCase();
          if (!ABSENCE_KEY_RE.test(key)) return next(new AppError(400, 'key muss kebab/snake-case sein (a-z, 0-9, "-", "_")'));
          if (key === 'holiday') return next(new AppError(400, "'holiday' ist als Sonderwert für Feiertage reserviert"));
          if (key !== type.key) {
            // key-Änderung nur, solange keine WorkDays den alten Key tragen
            // (sonst zerrisse das Mapping zu bestehenden Tagen).
            const used = await WorkDay.count({ where: { absence: type.key } });
            if (used > 0) {
              return res.status(409).json({ error: 'IN_USE', code: 'IN_USE', message: 'Key kann nicht geändert werden: Es existieren Tage mit dieser Abwesenheit.' });
            }
            const scopes: any[] = [{ companyId: null }];
            if (type.companyId != null) scopes.push({ companyId: type.companyId });
            const clash = await AbsenceType.findOne({ where: { key, id: { [Op.ne]: type.id }, [Op.or]: scopes } });
            if (clash) return res.status(409).json({ error: 'KEY_EXISTS', code: 'KEY_EXISTS', message: `Eine Abwesenheitsart mit dem Key '${key}' existiert bereits.` });
            updates.key = key;
          }
        }
      } else if (b.key !== undefined && String(b.key).trim().toLowerCase() !== type.key) {
        return next(new AppError(400, 'Der Key eingebauter Arten kann nicht geändert werden'));
      }

      const oldValues = typeJson(type);
      await type.update(updates);

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        category: AuditCategory.SYSTEM_SETTINGS,
        entity: 'AbsenceType',
        entityId: type.id,
        oldValues,
        newValues: typeJson(type),
      }, req);

      res.json({ absenceType: typeJson(type) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * DELETE /api/absence-types/:id (admin) — Builtin nie löschbar (400);
   * referenzierte Arten (WorkDay.absence=key) → 409 IN_USE.
   */
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const id = Number(req.params.id);
      if (!Number.isFinite(id)) return next(new AppError(400, 'Ungültige ID'));
      const type = await AbsenceType.findByPk(id);
      if (!type) return next(new AppError(404, 'Abwesenheitsart nicht gefunden'));
      if (type.isBuiltin) return next(new AppError(400, 'Eingebaute Abwesenheitsarten können nicht gelöscht werden'));

      if (type.companyId != null) {
        const managed = await getManagedCompanyIds(req.user!);
        if (managed !== null && !managed.includes(type.companyId)) {
          return next(new AppError(403, 'Kein Zugriff auf diese Abwesenheitsart'));
        }
      }

      const used = await WorkDay.count({ where: { absence: type.key } });
      if (used > 0) {
        return res.status(409).json({
          error: 'IN_USE',
          code: 'IN_USE',
          message: `Abwesenheitsart wird von ${used} Tag(en) verwendet — bitte stattdessen deaktivieren.`,
          days: used,
        });
      }

      const oldValues = typeJson(type);
      await type.destroy();

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        category: AuditCategory.SYSTEM_SETTINGS,
        entity: 'AbsenceType',
        entityId: id,
        oldValues,
      }, req);

      res.json({ deleted: true });
    } catch (error) {
      next(error);
    }
  }
}
