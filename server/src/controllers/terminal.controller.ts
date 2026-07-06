import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import bcrypt from 'bcryptjs';
import {
  TerminalDevice,
  TerminalConfig,
  TERMINAL_METHODS,
  generateTerminalToken,
  hashTerminalToken,
} from '../models/TerminalDevice';
import { Company } from '../models/Company';
import { AppError } from '../middleware/errorHandler';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import {
  getEffectiveActor,
  getCompanyScopeWhere,
  canManageCompanyRecord,
  resolveWritableCompanyId,
} from '../services/accessScope';

/**
 * Admin-CRUD für Stempel-Terminals (/api/terminals).
 * Firmen-gescopet über accessScope; das Geräte-Token wird NUR in der
 * Create-Antwort einmalig im Klartext ausgegeben (DB speichert den SHA-256-Hash).
 */

/** Config aus Client-Eingabe validieren/normalisieren (auf Basis der bisherigen Config). */
function sanitizeConfig(input: any, base: TerminalConfig): TerminalConfig {
  if (input == null || typeof input !== 'object') return base;
  let methods = base.methods;
  if (input.methods !== undefined) {
    if (!Array.isArray(input.methods)) throw new AppError(400, 'config.methods muss ein Array sein');
    const cleaned = input.methods.filter((m: any) => (TERMINAL_METHODS as readonly string[]).includes(m));
    if (cleaned.length === 0) throw new AppError(400, `config.methods muss mindestens eine gültige Methode enthalten (${TERMINAL_METHODS.join(', ')})`);
    methods = cleaned;
  }
  let requirePin = base.requirePin;
  if (input.requirePin !== undefined) {
    if (typeof input.requirePin !== 'boolean') throw new AppError(400, 'config.requirePin muss boolean sein');
    requirePin = input.requirePin;
  }
  return { methods, requirePin };
}

/** lat/lng aus dem Body normalisieren (null = entfernen). */
function parseCoord(value: any, field: string): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new AppError(400, `Ungültiger Wert für ${field}`);
  return n;
}

/**
 * settingsPassword aus dem Body → bcrypt-Hash für settingsPasswordHash.
 * - undefined  → Feld nicht angefasst (unverändert)
 * - null / ''  → Schutz entfernen (Hash = null)
 * - String ≥ 4 → neuer Hash
 */
async function parseSettingsPassword(value: any): Promise<string | null | undefined> {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  if (typeof value !== 'string' || value.length < 4) {
    throw new AppError(400, 'settingsPassword muss mindestens 4 Zeichen haben');
  }
  return bcrypt.hash(value, 10);
}

export class TerminalController {
  /** GET /api/terminals — Terminals im Firmen-Scope (ohne tokenHash, mit tokenPrefix/lastSeenAt). */
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      // Pragmatische Schema-Nachrüstung (Bestands-DB): Spalte settings_password_hash
      // idempotent ergänzen; internes Modul-Flag verhindert wiederholte Läufe.
      await TerminalDevice.ensureSchema();
      const actor = getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId);
      const terminals = await TerminalDevice.findAll({
        where: getCompanyScopeWhere(actor),
        order: [['name', 'ASC']],
      });
      res.json({ terminals: terminals.map((t) => t.toSafeJSON()) });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/terminals — Terminal registrieren (admin).
   * Antwort enthält das Geräte-Token im Klartext — EINMALIG, danach nie wieder.
   */
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      // Terminals sind IMMER firmengebunden: Firmen-Admin → eigene Firma;
      // Super-/globaler Admin und Mandanten-Admin → companyId aus dem Body
      // (Verwaltbarkeit wird geprüft).
      let companyId = await resolveWritableCompanyId(req.user!, req.body.companyId);
      if (companyId == null && req.body.companyId != null && req.body.companyId !== '') {
        const cid = Number(req.body.companyId);
        if (Number.isFinite(cid) && (await canManageCompanyRecord(req.user!, cid))) companyId = cid;
      }
      if (companyId == null) {
        return next(new AppError(400, 'companyId ist erforderlich (Terminals sind immer einer Firma zugeordnet)'));
      }
      const company = await Company.findByPk(companyId, { attributes: ['id'] });
      if (!company) return next(new AppError(404, 'Firma nicht gefunden'));

      await TerminalDevice.ensureSchema(); // Bestands-DB: Spalte sicherstellen (idempotent)

      const token = generateTerminalToken();
      const terminal = await TerminalDevice.create({
        companyId,
        name: String(req.body.name).trim(),
        tokenHash: hashTerminalToken(token),
        tokenPrefix: token.slice(0, 8),
        locationLabel: typeof req.body.locationLabel === 'string' && req.body.locationLabel.trim() ? req.body.locationLabel.trim() : null,
        lat: parseCoord(req.body.lat, 'lat'),
        lng: parseCoord(req.body.lng, 'lng'),
        isActive: req.body.isActive !== undefined ? Boolean(req.body.isActive) : true,
        settingsPasswordHash: (await parseSettingsPassword(req.body.settingsPassword)) ?? null,
        config: sanitizeConfig(req.body.config, { methods: ['nfc', 'code', 'qr'], requirePin: false }),
      });

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'TerminalDevice',
        entityId: terminal.id,
        newValues: { name: terminal.name, companyId, tokenPrefix: terminal.tokenPrefix },
      }, req);

      res.status(201).json({
        message: 'Terminal registriert. Das Token wird nur dieses eine Mal angezeigt!',
        terminal: terminal.toSafeJSON(),
        token, // Vollwert NUR hier
      });
    } catch (error) {
      next(error);
    }
  }

  /** PUT /api/terminals/:id — name/locationLabel/lat/lng/config/isActive ändern (admin). */
  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        res.status(400).json({ errors: errors.array() });
        return;
      }

      await TerminalDevice.ensureSchema(); // Bestands-DB: Spalte sicherstellen (idempotent)

      const terminal = await TerminalDevice.findByPk(req.params.id);
      if (!terminal || !(await canManageCompanyRecord(req.user!, terminal.companyId))) {
        return next(new AppError(404, 'Terminal nicht gefunden'));
      }

      const old = terminal.toSafeJSON();
      const data: any = {};
      if (req.body.name !== undefined) data.name = String(req.body.name).trim();
      if (req.body.locationLabel !== undefined) {
        data.locationLabel = typeof req.body.locationLabel === 'string' && req.body.locationLabel.trim() ? req.body.locationLabel.trim() : null;
      }
      if (req.body.lat !== undefined) data.lat = parseCoord(req.body.lat, 'lat');
      if (req.body.lng !== undefined) data.lng = parseCoord(req.body.lng, 'lng');
      if (req.body.isActive !== undefined) data.isActive = Boolean(req.body.isActive);
      if (req.body.config !== undefined) data.config = sanitizeConfig(req.body.config, terminal.getConfig());
      // settingsPassword: undefined = unverändert, ''/null = Schutz entfernen, sonst neuer Hash.
      const spHash = await parseSettingsPassword(req.body.settingsPassword);
      if (spHash !== undefined) data.settingsPasswordHash = spHash;

      await terminal.update(data);

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'TerminalDevice',
        entityId: terminal.id,
        oldValues: old,
        newValues: terminal.toSafeJSON(),
      }, req);

      res.json({ message: 'Terminal aktualisiert', terminal: terminal.toSafeJSON() });
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/terminals/:id/regenerate-token — neues Geräte-Token erzeugen (admin).
   * Das alte Token wird sofort ungültig; der Neuwert wird EINMALIG zurückgegeben
   * (z. B. wenn das Token verloren ging oder ein Gerät getauscht wird).
   */
  async regenerateToken(req: Request, res: Response, next: NextFunction) {
    try {
      const terminal = await TerminalDevice.findByPk(req.params.id);
      if (!terminal || !(await canManageCompanyRecord(req.user!, terminal.companyId))) {
        return next(new AppError(404, 'Terminal nicht gefunden'));
      }

      const oldPrefix = terminal.tokenPrefix;
      const token = generateTerminalToken();
      await terminal.update({
        tokenHash: hashTerminalToken(token),
        tokenPrefix: token.slice(0, 8),
      });

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.UPDATE,
        category: AuditCategory.SECURITY,
        entity: 'TerminalDevice',
        entityId: terminal.id,
        oldValues: { tokenPrefix: oldPrefix },
        newValues: { tokenPrefix: terminal.tokenPrefix, tokenRegenerated: true },
      }, req);

      res.json({
        message: 'Neues Token erzeugt. Es wird nur dieses eine Mal angezeigt — das alte Token ist ab sofort ungültig!',
        terminal: terminal.toSafeJSON(),
        token, // Vollwert NUR hier
      });
    } catch (error) {
      next(error);
    }
  }

  /** DELETE /api/terminals/:id — Terminal entfernen (admin). Stempelungen bleiben erhalten. */
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const terminal = await TerminalDevice.findByPk(req.params.id);
      if (!terminal || !(await canManageCompanyRecord(req.user!, terminal.companyId))) {
        return next(new AppError(404, 'Terminal nicht gefunden'));
      }

      const old = terminal.toSafeJSON();
      await terminal.destroy();

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.DELETE,
        category: AuditCategory.DATA_MANAGEMENT,
        entity: 'TerminalDevice',
        entityId: old.id,
        oldValues: old,
      }, req);

      res.json({ message: 'Terminal gelöscht' });
    } catch (error) {
      next(error);
    }
  }
}
