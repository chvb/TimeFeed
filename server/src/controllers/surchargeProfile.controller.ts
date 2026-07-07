import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import { SurchargeProfile, SurchargeWindow } from '../models/SurchargeProfile';
import { Group } from '../models/Group';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { getEffectiveActor, getCompanyScopeWhere, canManageCompanyRecord, resolveWritableCompanyId } from '../services/accessScope';
import { hhmmToMinutes } from '../services/surchargeService';

/**
 * Zuschlagsprofile (Yellowfox-Parität Paket 2, z. B. Nachtarbeit) — CRUD nach
 * dem Muster des timeModel.controller: lesen admin/buchhaltung/verwaltung,
 * schreiben admin, DELETE 409 solange Gruppen/Mitarbeiter referenzieren.
 */

/** Maximal erlaubte Fenster je Profil (UI-Editor bleibt überschaubar). */
const MAX_WINDOWS = 20;

/**
 * Fenster-Array aus dem Request validieren/normalisieren.
 * Jedes Fenster: from/to als HH:MM (to <= from = über Mitternacht), Lohnart
 * nicht leer, percent 0–1000, Label optional. Wirft AppError(400) bei Fehlern.
 */
export function validateWindows(raw: any): SurchargeWindow[] {
  if (raw == null) return [];
  if (!Array.isArray(raw)) throw new AppError(400, 'windows muss ein Array von Zuschlagsfenstern sein');
  if (raw.length > MAX_WINDOWS) throw new AppError(400, `Maximal ${MAX_WINDOWS} Fenster je Profil`);
  return raw.map((w: any, i: number) => {
    const from = String(w?.from ?? '').trim();
    const to = String(w?.to ?? '').trim();
    if (hhmmToMinutes(from) == null || hhmmToMinutes(to) == null) {
      throw new AppError(400, `Fenster ${i + 1}: von/bis müssen gültige Uhrzeiten (HH:MM) sein`);
    }
    const lohnart = String(w?.lohnart ?? '').trim();
    if (!lohnart) throw new AppError(400, `Fenster ${i + 1}: Lohnart darf nicht leer sein`);
    const percent = Number(w?.percent ?? 0);
    if (!Number.isFinite(percent) || percent < 0 || percent > 1000) {
      throw new AppError(400, `Fenster ${i + 1}: Zuschlag (%) muss zwischen 0 und 1000 liegen`);
    }
    return { from, to, lohnart, percent, label: String(w?.label ?? '').trim() };
  });
}

/**
 * Validiert eine Zuschlagsprofil-Zuordnung (Gruppe/User): das Profil muss
 * existieren und zur selben Firma gehören (companyId=null = global nutzbar).
 * Gibt die normalisierte ID zurück (null = Zuordnung entfernen).
 * Gleiches Muster wie validateTimeModelAssignment.
 */
export async function validateSurchargeProfileAssignment(surchargeProfileId: any, companyId: number | null): Promise<number | null> {
  if (surchargeProfileId == null || surchargeProfileId === '') return null;
  const id = Number(surchargeProfileId);
  if (!Number.isFinite(id)) throw new AppError(400, 'Ungültige Zuschlagsprofil-ID');
  const p = await SurchargeProfile.findByPk(id, { attributes: ['id', 'companyId'] });
  if (!p) throw new AppError(404, 'Zuschlagsprofil nicht gefunden');
  if (p.companyId != null && p.companyId !== companyId) {
    throw new AppError(400, 'Zuschlagsprofil gehört zu einer anderen Firma');
  }
  return id;
}

const profileJson = (p: SurchargeProfile) => ({
  id: p.id,
  companyId: p.companyId ?? null,
  name: p.name,
  isActive: !!p.isActive,
  windows: p.getParsedWindows(),
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

export class SurchargeProfileController {
  /** GET /api/surcharge-profiles — Profile im Firmen-Scope des Akteurs. */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId);
      const profiles = await SurchargeProfile.findAll({
        where: getCompanyScopeWhere(actor),
        order: [['name', 'ASC']],
      });
      res.json({ surchargeProfiles: profiles.map(profileJson) });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/surcharge-profiles — neues Zuschlagsprofil (admin). */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const companyId = await resolveWritableCompanyId(req.user!, req.body.companyId);
      const profile = await SurchargeProfile.create({
        companyId,
        name: String(req.body.name).trim(),
        isActive: req.body.isActive === undefined ? true : !!req.body.isActive,
        windows: validateWindows(req.body.windows),
      });
      res.status(201).json({ message: 'Zuschlagsprofil angelegt', surchargeProfile: profileJson(profile) });
    } catch (error) {
      next(error);
    }
  }

  /** PUT /api/surcharge-profiles/:id — Zuschlagsprofil bearbeiten (admin). */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      const profile = await SurchargeProfile.findByPk(req.params.id);
      if (!profile || !(await canManageCompanyRecord(req.user!, profile.companyId))) {
        return next(new AppError(404, 'Zuschlagsprofil nicht gefunden'));
      }
      const data: any = {};
      if (req.body.name !== undefined) data.name = String(req.body.name).trim();
      if (req.body.isActive !== undefined) data.isActive = !!req.body.isActive;
      if (req.body.windows !== undefined) data.windows = validateWindows(req.body.windows);
      await profile.update(data);
      res.json({ message: 'Zuschlagsprofil aktualisiert', surchargeProfile: profileJson(profile) });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/surcharge-profiles/:id — 409, solange Gruppen/Nutzer es referenzieren. */
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const profile = await SurchargeProfile.findByPk(req.params.id);
      if (!profile || !(await canManageCompanyRecord(req.user!, profile.companyId))) {
        return next(new AppError(404, 'Zuschlagsprofil nicht gefunden'));
      }
      const [groupRefs, userRefs] = await Promise.all([
        Group.count({ where: { surchargeProfileId: profile.id } }),
        User.count({ where: { surchargeProfileId: profile.id } }),
      ]);
      if (groupRefs > 0 || userRefs > 0) {
        return next(new AppError(409, `Zuschlagsprofil wird noch verwendet (${groupRefs} Gruppe(n), ${userRefs} Mitarbeiter)`));
      }
      await profile.destroy();
      res.json({ message: 'Zuschlagsprofil gelöscht' });
    } catch (error) {
      next(error);
    }
  }
}
