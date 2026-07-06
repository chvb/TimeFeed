import { Request, Response, NextFunction } from 'express';
import { Op } from 'sequelize';
import { validationResult } from 'express-validator';
import { User, UserRole } from '../models/User';
import { Group } from '../models/Group';
import { GroupManager } from '../models/GroupManager';
import { sequelize } from '../db/database';
import { AppError } from '../middleware/errorHandler';
import { getEffectiveActor, getAccessibleUserIds, canActorAccessUser, canManageCompanyRecord, resolveWritableCompanyId, getManagedCompanyIds } from '../services/accessScope';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import { moveToTrash } from '../services/trashService';
import { validateTimeModelAssignment } from './timeModel.controller';
import { generateStampCode } from '../models/User';
import QRCode from 'qrcode';

import crypto from 'crypto';

// Geheimnisse NIE ausliefern; stampCode nur für admin/buchhaltung/verwaltung
// (steckt im NFC-Chip/QR — Mitarbeiter brauchen ihn nicht im Klartext in der App).
const STAMP_CODE_ROLES = new Set<string>([UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG]);
export function userAttributeExcludes(actor: { role: string; isSuperAdmin?: boolean }): string[] {
  const excludes = ['password', 'pin'];
  if (!actor.isSuperAdmin && !STAMP_CODE_ROLES.has(actor.role)) excludes.push('stampCode');
  return excludes;
}

// PIN-Format (Terminal-Codeeingabe): 4–8 Ziffern.
const PIN_RE = /^\d{4,8}$/;

export class UserController {
  // Kollegen-Liste (id + Name) aus dem eigenen Team – für alle Rollen.
  async getColleagues(req: Request, res: Response, next: NextFunction) {
    try {
      const me = await User.findByPk(req.user!.id, { attributes: ['id', 'groupId', 'companyId'] });
      const where: any = { isActive: true, id: { [Op.ne]: req.user!.id } };
      // Nie firmenübergreifend (nur eigene Firma).
      if (me?.companyId) where.companyId = me.companyId;
      // Mit Gruppe: nur eigenes Team. Ohne Gruppe: Fallback = alle aktiven der eigenen Firma.
      if (me?.groupId) where.groupId = me.groupId;
      const colleagues = await User.findAll({
        where,
        attributes: ['id', 'firstName', 'lastName'],
        order: [['firstName', 'ASC']],
      });
      res.json({ colleagues });
    } catch (e) {
      next(e);
    }
  }

  async getAllUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const { groupId, role, isActive } = req.query;
      const where: any = {};

      if (groupId) where.groupId = groupId;
      if (role) where.role = role;
      if (isActive !== undefined) where.isActive = isActive === 'true';

      // Verwaltung sieht nur Mitglieder ihrer Gruppe(n); Admin/Buchhaltung alle.
      const accessibleIds = await getAccessibleUserIds(getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId));
      if (accessibleIds !== null) where.id = accessibleIds;

      const users = await User.findAll({
        where,
        attributes: { exclude: userAttributeExcludes(req.user!) },
        include: [
          { model: Group, as: 'group', attributes: ['id', 'name'] },
        ],
        order: [['lastName', 'ASC'], ['firstName', 'ASC']],
      });

      res.json({ users });
    } catch (error) {
      next(error);
    }
  }

  async getUserById(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await User.findByPk(req.params.id, {
        attributes: { exclude: userAttributeExcludes(req.user!) },
        include: [
          { model: Group, as: 'group' },
        ],
      });

      if (!user) {
        return next(new AppError(404, 'User not found'));
      }

      if (req.user!.id !== user.id && !(await canActorAccessUser(req.user!, user.id))) {
        return next(new AppError(403, 'Not authorized to view this user'));
      }

      res.json({ user });
    } catch (error) {
      next(error);
    }
  }

  // Geburtstage (für Kalender/Feed): Admin/Buchhaltung alle, sonst eigene Gruppe. Nur Tag/Monat relevant.
  async getBirthdays(req: Request, res: Response, next: NextFunction) {
    try {
      const actor = getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId);
      const where: any = { isActive: true, birthDate: { [Op.ne]: null } };
      if (actor.role === 'admin' || actor.role === 'buchhaltung' || actor.isSuperAdmin) {
        // Admin/Buchhaltung: eigene Firma (bzw. gewählte Firma); Super-Admin ohne Wahl = alle.
        if (actor.companyId) where.companyId = actor.companyId;
      } else {
        const me = await User.findByPk(req.user!.id, { attributes: ['id', 'groupId'] });
        if (me?.groupId) where.groupId = me.groupId; else where.id = req.user!.id;
      }
      const users = await User.findAll({ where, attributes: ['id', 'firstName', 'lastName', 'birthDate'], order: [['firstName', 'ASC']] });
      res.json({ birthdays: users });
    } catch (e) {
      next(e);
    }
  }

  // CSV-Import: legt Mitarbeiter an bzw. aktualisiert sie (Abgleich per E-Mail).
  async importUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const csv: string = (req.body && req.body.csv) || '';
      if (!csv.trim()) return next(new AppError(400, 'Keine CSV-Daten übergeben'));
      const lines = csv.split(/\r?\n/).filter((l) => l.trim());
      if (lines.length < 2) return next(new AppError(400, 'CSV enthält keine Datenzeilen'));
      const delim = lines[0].includes(';') ? ';' : ',';
      const parseLine = (l: string) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ''));
      const header = parseLine(lines[0]).map((h) => h.toLowerCase());
      const col = (names: string[]) => { for (const n of names) { const i = header.indexOf(n); if (i >= 0) return i; } return -1; };
      const idx: Record<string, number> = {
        firstName: col(['firstname', 'vorname']),
        lastName: col(['lastname', 'nachname']),
        email: col(['email', 'e-mail', 'mail']),
        role: col(['role', 'rolle']),
        department: col(['department', 'abteilung']),
        position: col(['position']),
        employeeNumber: col(['employeenumber', 'personalnummer', 'persnr']),
        entryDate: col(['entrydate', 'eintritt', 'eintrittsdatum']),
      };
      if (idx.email < 0) return next(new AppError(400, 'Pflichtspalte "email" fehlt in der CSV'));

      const validRoles = Object.values(UserRole) as string[];
      // Firma der importierten Nutzer + Scope für den E-Mail-Abgleich (kein firmenübergreifendes Überschreiben).
      const importCompanyId = await resolveWritableCompanyId(req.user!, req.body.companyId);
      const managed = await getManagedCompanyIds(req.user!);
      let created = 0; let updated = 0; const errors: string[] = [];

      for (let i = 1; i < lines.length; i++) {
        const cells = parseLine(lines[i]);
        const get = (k: string) => (idx[k] >= 0 ? (cells[idx[k]] || '') : '');
        const email = get('email').toLowerCase();
        if (!email || !email.includes('@')) { errors.push(`Zeile ${i + 1}: ungültige E-Mail`); continue; }
        let role = get('role').toLowerCase();
        if (!validRoles.includes(role)) role = UserRole.MITARBEITER;
        const fields: any = {
          firstName: get('firstName'), lastName: get('lastName'), role,
          department: get('department') || null, position: get('position') || null,
          employeeNumber: get('employeeNumber') || null, entryDate: get('entryDate') || null,
        };
        const isAdminRole = fields.role === UserRole.ADMIN || fields.role === UserRole.BUCHHALTUNG;
        try {
          // Abgleich nur innerhalb der eigenen Firmen (Super-Admin: global).
          const existing = await User.findOne({ where: managed !== null ? { email, companyId: managed } : { email } });
          if (existing) {
            for (const [k, v] of Object.entries(fields)) if (v !== '' && v != null) (existing as any)[k] = v;
            // Guardrail: kein instanzweiter Admin (admin/buchhaltung ohne Firma+Mandant, nicht Super) per Import.
            if (isAdminRole && existing.companyId == null && existing.tenantId == null && !existing.isSuperAdmin) {
              errors.push(`Zeile ${i + 1}: Admin/Buchhaltung ohne Firma/Mandant ist per Import nicht erlaubt (instanzweiter Zugriff)`);
              continue;
            }
            await existing.save();
            updated++;
          } else {
            if (!fields.firstName || !fields.lastName) { errors.push(`Zeile ${i + 1}: Vor-/Nachname fehlt`); continue; }
            // Guardrail: neuer admin/buchhaltung ohne zugeordnete Firma wäre instanzweit → ablehnen.
            if (isAdminRole && importCompanyId == null) {
              errors.push(`Zeile ${i + 1}: Admin/Buchhaltung ohne Firma ist per Import nicht erlaubt (instanzweiter Zugriff)`);
              continue;
            }
            await User.create({
              email,
              password: crypto.randomBytes(9).toString('base64') + 'A1!',
              ...fields,
              companyId: importCompanyId,
              isActive: true,
            });
            created++;
          }
        } catch (e: any) {
          errors.push(`Zeile ${i + 1}: ${e?.message || 'Fehler'}`);
        }
      }

      await AuditService.log({ userId: req.user!.id, action: AuditAction.IMPORT, category: AuditCategory.IMPORT_EXPORT, entity: 'User', additionalData: { created, updated, errors: errors.length } }, req);
      res.json({ created, updated, errors });
    } catch (e) {
      next(e);
    }
  }

  async createUser(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const {
        email,
        password,
        firstName,
        lastName,
        role,
        groupId,
        department,
        position,
        phoneNumber,
        startDate,
        entryDate,
        birthDate,
        employeeNumber,
      } = req.body;

      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return next(new AppError(400, 'Email already exists'));
      }

      // Mandanten-/Firmen-Zuordnung:
      // - Super-Admin: Firma + Tenant frei (Tenant ohne Firma + Rolle admin/buchhaltung = Mandanten-Admin); isSuperAdmin setzbar.
      // - Mandanten-Admin: legt in einer Firma SEINES Tenants an (companyId aus Body), kein Tenant/Super.
      // - Firmen-Admin/Buchhaltung: ausschließlich eigene Firma.
      let companyId: number | null;
      let tenantId: number | null = null;
      let isSuperAdmin = false;
      if (req.user!.isSuperAdmin) {
        companyId = req.body.companyId ?? null;
        tenantId = req.body.tenantId ?? null;
        isSuperAdmin = !!req.body.isSuperAdmin;
      } else if (req.user!.tenantId && !req.user!.companyId) {
        companyId = req.body.companyId ?? null; // Frontend bietet nur Firmen des eigenen Tenants
        // Mandanten-Admin muss eine Firma seines Tenants wählen (kein firmenloser/globaler Account).
        if (companyId == null) {
          return next(new AppError(400, 'Bitte eine Firma wählen.'));
        }
        if (!(await canManageCompanyRecord(req.user!, companyId))) {
          return next(new AppError(403, 'Firma liegt außerhalb Ihres Mandanten'));
        }
      } else {
        companyId = req.user!.companyId ?? null;
      }

      // Schutz vor versehentlich instanzweiten Admins: admin/buchhaltung OHNE Firma UND OHNE Mandant
      // hätte (über isUnrestricted) Vollzugriff. Das ist nur mit ausdrücklichem Super-Admin-Flag erlaubt.
      if ((role === UserRole.ADMIN || role === UserRole.BUCHHALTUNG) && companyId == null && tenantId == null && !isSuperAdmin) {
        return next(new AppError(400, 'Admin/Buchhaltung ohne Firma und ohne Mandant hätte instanzweiten Vollzugriff. Bitte eine Firma oder einen Mandanten zuordnen – oder das Konto ausdrücklich als Super-Admin kennzeichnen.'));
      }

      // Gruppe muss im eigenen Scope liegen (keine Zuordnung in firmenfremde Gruppen).
      if (groupId != null) {
        const grp = await Group.findByPk(groupId, { attributes: ['companyId'] });
        if (!grp || !(await canManageCompanyRecord(req.user!, (grp as any).companyId))) {
          return next(new AppError(400, 'Gruppe liegt außerhalb Ihres Bereichs'));
        }
      }

      // Zeiterfassung: Zeitmodell-Override (muss zur Firma passen) + PIN (4–8 Ziffern).
      const timeModelId = req.body.timeModelId !== undefined
        ? await validateTimeModelAssignment(req.body.timeModelId, companyId)
        : null;
      if (req.body.pin != null && req.body.pin !== '' && !PIN_RE.test(String(req.body.pin))) {
        return next(new AppError(400, 'PIN muss aus 4–8 Ziffern bestehen'));
      }

      const user = await User.create({
        email,
        password,
        firstName,
        lastName,
        role,
        companyId,
        tenantId,
        isSuperAdmin,
        groupId,
        workingDaysOverride: req.body.workingDaysOverride ?? null,
        hoursPerDayOverride: req.body.hoursPerDayOverride ?? null,
        department,
        position,
        phoneNumber,
        startDate: startDate || new Date(),
        entryDate: entryDate || null,
        birthDate: birthDate || null,
        employeeNumber: employeeNumber || null,
        timeModelId,
        nfcTagUid: req.body.nfcTagUid || null,
        pin: req.body.pin ? String(req.body.pin) : null, // wird im Model-Hook bcrypt-gehasht
        isActive: true,
      });

      const userWithoutPassword = await User.findByPk(user.id, {
        attributes: { exclude: userAttributeExcludes(req.user!) },
      });

      await AuditService.logUserChange(AuditAction.USER_CREATED, req.user!.id, user.id, undefined, { email: user.email, role: user.role }, req);

      res.status(201).json({
        message: 'User created successfully',
        user: userWithoutPassword
      });
    } catch (error) {
      next(error);
    }
  }

  async updateUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!(await canActorAccessUser(req.user!, Number(req.params.id)))) return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const user = await User.findByPk(req.params.id);
      if (!user) {
        return next(new AppError(404, 'User not found'));
      }

      const {
        email,
        firstName,
        lastName,
        role,
        groupId,
        department,
        position,
        phoneNumber,
        entryDate,
        birthDate,
        employeeNumber,
      } = req.body;

      if (email && email !== user.email) {
        const existingUser = await User.findOne({ where: { email } });
        if (existingUser && String(existingUser.id) !== String(user.id)) {
          return next(new AppError(400, 'Email already exists'));
        }
        user.email = email;
      }

      if (firstName) user.firstName = firstName;
      if (lastName) user.lastName = lastName;
      if (role && role !== user.role) {
        // Rollenänderung nur durch Admins, und nicht für die eigene Rolle
        // (verhindert Buchhaltung-Selbst-/Fremd-Eskalation auf admin).
        if (req.user!.role !== UserRole.ADMIN) {
          return next(new AppError(403, 'Only admins may change roles'));
        }
        if (user.id === req.user!.id) {
          return next(new AppError(403, 'You cannot change your own role'));
        }
        user.role = role;
      }
      if (groupId !== undefined) {
        if (groupId != null) {
          const grp = await Group.findByPk(groupId, { attributes: ['companyId'] });
          if (!grp || !(await canManageCompanyRecord(req.user!, (grp as any).companyId))) {
            return next(new AppError(400, 'Gruppe liegt außerhalb Ihres Bereichs'));
          }
        }
        user.groupId = groupId;
      }
      // Mandanten-Zuordnung nur durch Super-Admin änderbar (Firmen-Admin kann Nutzer
      // nicht in andere Firmen verschieben oder Super-Admins ernennen).
      if (req.user!.isSuperAdmin) {
        if (req.body.companyId !== undefined) user.companyId = req.body.companyId ?? null;
        if (req.body.tenantId !== undefined) user.tenantId = req.body.tenantId ?? null;
        if (req.body.isSuperAdmin !== undefined && user.id !== req.user!.id) user.isSuperAdmin = !!req.body.isSuperAdmin;
      }
      // Schutz vor versehentlich instanzweiten Admins (siehe createUser): admin/buchhaltung ohne Firma
      // UND ohne Mandant ist nur mit ausdrücklichem Super-Admin-Flag zulässig.
      if ((user.role === UserRole.ADMIN || user.role === UserRole.BUCHHALTUNG) && user.companyId == null && user.tenantId == null && !user.isSuperAdmin) {
        return next(new AppError(400, 'Admin/Buchhaltung ohne Firma und ohne Mandant hätte instanzweiten Vollzugriff. Bitte eine Firma oder einen Mandanten zuordnen – oder das Konto ausdrücklich als Super-Admin kennzeichnen.'));
      }
      if (department !== undefined) user.department = department;
      if (position !== undefined) user.position = position;
      if (phoneNumber !== undefined) user.phoneNumber = phoneNumber;
      if (entryDate !== undefined) user.entryDate = entryDate;
      if (birthDate !== undefined) user.birthDate = birthDate || null;
      if (employeeNumber !== undefined) user.employeeNumber = employeeNumber;
      // Teilzeit-Beschäftigungsgrad (1 = Vollzeit) + Austrittsdatum (für anteilige Sollzeit).
      if (req.body.employmentFactor !== undefined) {
        const ef = req.body.employmentFactor;
        user.employmentFactor = (ef === null || ef === '') ? 1 : Number(ef);
      }
      if (req.body.exitDate !== undefined) {
        user.exitDate = req.body.exitDate ? new Date(req.body.exitDate) : null;
      }
      // Individuelle Arbeitstage (Array = abweichend, null = global).
      if (req.body.workingDaysOverride !== undefined) {
        user.workingDaysOverride = req.body.workingDaysOverride;
      }
      if (req.body.hoursPerDayOverride !== undefined) {
        user.hoursPerDayOverride = req.body.hoursPerDayOverride;
      }
      // Zeiterfassung: Zeitmodell-Override, NFC-Tag, PIN (nur setzen/löschen —
      // gehasht gespeichert, nie zurückgegeben).
      if (req.body.timeModelId !== undefined) {
        user.timeModelId = await validateTimeModelAssignment(req.body.timeModelId, user.companyId ?? null);
      }
      if (req.body.nfcTagUid !== undefined) {
        user.nfcTagUid = req.body.nfcTagUid || null;
      }
      if (req.body.pin !== undefined) {
        if (req.body.pin === null || req.body.pin === '') {
          user.pin = null;
        } else if (!PIN_RE.test(String(req.body.pin))) {
          return next(new AppError(400, 'PIN muss aus 4–8 Ziffern bestehen'));
        } else {
          user.pin = String(req.body.pin); // Model-Hook hasht
        }
      }

      await user.save();

      const updatedUser = await User.findByPk(user.id, {
        attributes: { exclude: userAttributeExcludes(req.user!) },
      });

      await AuditService.logUserChange(AuditAction.USER_UPDATED, req.user!.id, user.id, undefined, { role: user.role }, req);

      res.json({
        message: 'User updated successfully',
        user: updatedUser
      });
    } catch (error) {
      next(error);
    }
  }

  async deleteUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!(await canActorAccessUser(req.user!, Number(req.params.id)))) return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      const user = await User.findByPk(req.params.id);
      if (!user) {
        return next(new AppError(404, 'User not found'));
      }

      // Selbstlöschung verhindern.
      if (String(user.id) === String(req.user!.id)) {
        return next(new AppError(400, 'Sie können Ihren eigenen Account nicht löschen'));
      }

      // Letzten aktiven Administrator schützen (Aussperr-Schutz).
      if (user.role === UserRole.ADMIN) {
        const activeAdmins = await User.count({ where: { role: UserRole.ADMIN, isActive: true } });
        if (activeAdmins <= 1) {
          return next(new AppError(400, 'Der letzte aktive Administrator kann nicht gelöscht werden'));
        }
      }

      // Abhängige Daten transaktional entfernen, damit keine verwaisten Zeilen
      // mit totem userId zurückbleiben (keine FK-Cascade in SQLite aktiv).
      await sequelize.transaction(async (t) => {
        const gms = await GroupManager.findAll({ where: { userId: user.id }, transaction: t });
        await moveToTrash('User', user, `${user.firstName} ${user.lastName}`, req.user!.id, {
          transaction: t,
          related: [
            { entityType: 'GroupManager', records: (gms as any[]).map((r) => r.get({ plain: true })) },
          ],
        });

        await GroupManager.destroy({ where: { userId: user.id }, transaction: t });
        await Group.update({ managerId: null } as any, { where: { managerId: user.id }, transaction: t });
        await AuditService.logUserChange(AuditAction.USER_DELETED, req.user!.id, user.id, undefined, undefined, req);
        await user.destroy({ transaction: t });
      });

      res.json({ message: 'User deleted successfully' });
    } catch (error) {
      next(error);
    }
  }

  async activateUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!(await canActorAccessUser(req.user!, Number(req.params.id)))) return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      const user = await User.findByPk(req.params.id);
      if (!user) {
        return next(new AppError(404, 'User not found'));
      }

      user.isActive = true;
      await user.save();

      res.json({ message: 'User activated successfully' });
    } catch (error) {
      next(error);
    }
  }

  /** POST /api/users/:id/regenerate-stamp-code — neuen eindeutigen Stempel-Code vergeben (admin). */
  async regenerateStampCode(req: Request, res: Response, next: NextFunction) {
    try {
      if (!(await canActorAccessUser(req.user!, Number(req.params.id)))) return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      const user = await User.findByPk(req.params.id);
      if (!user) {
        return next(new AppError(404, 'User not found'));
      }
      const oldCode = user.stampCode;
      user.stampCode = await generateStampCode();
      await user.save();
      await AuditService.logUserChange(AuditAction.USER_UPDATED, req.user!.id, user.id, { stampCode: oldCode }, { stampCode: user.stampCode }, req);
      res.json({ message: 'Stempel-Code neu generiert', stampCode: user.stampCode });
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/users/:id/stamp-qr — QR-Badge des Stempel-Codes als PNG (admin).
   * QR-Inhalt ist EXAKT der stampCode-String (fürs Terminal-Scannen/Ausdrucken);
   * Dateiname enthält den Mitarbeiternamen.
   */
  async stampQr(req: Request, res: Response, next: NextFunction) {
    try {
      if (!(await canActorAccessUser(req.user!, Number(req.params.id)))) {
        return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      }
      const user = await User.findByPk(req.params.id);
      if (!user) return next(new AppError(404, 'User not found'));
      if (!user.stampCode) return next(new AppError(404, 'Mitarbeiter hat keinen Stempel-Code'));

      const png = await QRCode.toBuffer(user.stampCode, {
        type: 'png',
        errorCorrectionLevel: 'M',
        width: 512,
        margin: 2,
      });

      // Dateiname mit Mitarbeiternamen (nur Header-sichere Zeichen).
      const safeName = `${user.firstName}-${user.lastName}`
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '') // diakritische Zeichen entfernen
        .replace(/[^a-zA-Z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'mitarbeiter';

      res.setHeader('Content-Type', 'image/png');
      res.setHeader('Content-Disposition', `attachment; filename="stempel-qr-${safeName}.png"`);
      res.send(png);
    } catch (error) {
      next(error);
    }
  }

  async deactivateUser(req: Request, res: Response, next: NextFunction) {
    try {
      if (!(await canActorAccessUser(req.user!, Number(req.params.id)))) return next(new AppError(403, 'Kein Zugriff auf diesen Mitarbeiter'));
      const user = await User.findByPk(req.params.id);
      if (!user) {
        return next(new AppError(404, 'User not found'));
      }

      user.isActive = false;
      await user.save();

      res.json({ message: 'User deactivated successfully' });
    } catch (error) {
      next(error);
    }
  }
}
