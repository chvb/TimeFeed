import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { TimeModel } from '../models/TimeModel';
import { Group } from '../models/Group';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { getEffectiveActor, getCompanyScopeWhere, canManageCompanyRecord, resolveWritableCompanyId } from '../services/accessScope';

/**
 * Validiert eine Zeitmodell-Zuordnung: das Modell muss existieren und zur selben
 * Firma gehören (globale Modelle mit companyId=null sind für alle nutzbar).
 * Gibt die normalisierte ID zurück (null = Zuordnung entfernen).
 */
export async function validateTimeModelAssignment(timeModelId: any, companyId: number | null): Promise<number | null> {
  if (timeModelId == null || timeModelId === '') return null;
  const id = Number(timeModelId);
  if (!Number.isFinite(id)) throw new AppError(400, 'Ungültige Zeitmodell-ID');
  const tm = await TimeModel.findByPk(id, { attributes: ['id', 'companyId'] });
  if (!tm) throw new AppError(404, 'Zeitmodell nicht gefunden');
  if (tm.companyId != null && tm.companyId !== companyId) {
    throw new AppError(400, 'Zeitmodell gehört zu einer anderen Firma');
  }
  return id;
}

// Vom Client änderbare Felder (kein Mass-Assignment von id/companyId über update).
const EDITABLE_FIELDS = [
  'name', 'isActive',
  'monMinutes', 'tueMinutes', 'wedMinutes', 'thuMinutes', 'friMinutes', 'satMinutes', 'sunMinutes',
  'roundingMode', 'roundingMinutes',
] as const;

export class TimeModelController {
  /** GET /api/time-models — Zeitmodelle im Firmen-Scope des Akteurs. */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId);
      const timeModels = await TimeModel.findAll({
        where: getCompanyScopeWhere(actor),
        order: [['name', 'ASC']],
      });
      res.json({ timeModels });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/time-models — neues Zeitmodell (admin). */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const companyId = await resolveWritableCompanyId(req.user!, req.body.companyId);
      const data: any = { companyId };
      for (const f of EDITABLE_FIELDS) {
        if (req.body[f] !== undefined) data[f] = req.body[f];
      }
      const timeModel = await TimeModel.create(data);
      res.status(201).json({ message: 'Zeitmodell angelegt', timeModel });
    } catch (error) {
      next(error);
    }
  }

  /** PUT /api/time-models/:id — Zeitmodell bearbeiten (admin). */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const timeModel = await TimeModel.findByPk(req.params.id);
      if (!timeModel || !(await canManageCompanyRecord(req.user!, timeModel.companyId))) {
        return next(new AppError(404, 'Zeitmodell nicht gefunden'));
      }
      const data: any = {};
      for (const f of EDITABLE_FIELDS) {
        if (req.body[f] !== undefined) data[f] = req.body[f];
      }
      await timeModel.update(data);
      res.json({ message: 'Zeitmodell aktualisiert', timeModel });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/time-models/:id — nur wenn keine Gruppe/kein Nutzer es referenziert. */
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const timeModel = await TimeModel.findByPk(req.params.id);
      if (!timeModel || !(await canManageCompanyRecord(req.user!, timeModel.companyId))) {
        return next(new AppError(404, 'Zeitmodell nicht gefunden'));
      }
      const [groupRefs, userRefs] = await Promise.all([
        Group.count({ where: { timeModelId: timeModel.id } }),
        User.count({ where: { timeModelId: timeModel.id } }),
      ]);
      if (groupRefs > 0 || userRefs > 0) {
        return next(new AppError(409, `Zeitmodell wird noch verwendet (${groupRefs} Gruppe(n), ${userRefs} Mitarbeiter)`));
      }
      await timeModel.destroy();
      res.json({ message: 'Zeitmodell gelöscht' });
    } catch (error) {
      next(error);
    }
  }
}
