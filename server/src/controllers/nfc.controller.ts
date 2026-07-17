import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { Op, literal } from 'sequelize';
import { User } from '../models/User';
import { SystemSettings } from '../models/SystemSettings';
import { Tenant } from '../models/Tenant';
import { Company } from '../models/Company';
import { API_SCOPE_LINK_ALL } from '../models/ApiKey';
import { AppError } from '../middleware/errorHandler';
import { verifyHubHandoff } from '../services/hubHandoff';

/** Globaler (mandantenübergreifender) Hub-Key? */
function keyIsGlobal(req: Request): boolean {
  return !!(req.apiKey && req.apiKey.hasScope(API_SCOPE_LINK_ALL));
}

// Scoped-Session nach NFC-Handoff: kurzlebig, ausschließlich fürs Stempeln.
const NFC_SESSION_MINUTES = 2;
export const NFC_STAMP_SCOPE = 'nfc:stamp';

// Einmal-Nutzung der Handoffs (Replay-Schutz): verbrauchte jtis kurz merken. In-Memory
// genügt – der Handoff lebt nur 120 s (Hub-TTL) und TimeFeed läuft als Einzelprozess.
const usedHandoffJti = new Map<string, number>();
function consumeJti(jti: string, ttlMs = 130_000): boolean {
  const now = Date.now();
  if (usedHandoffJti.size > 1000) {
    for (const [k, exp] of usedHandoffJti) if (exp <= now) usedHandoffJti.delete(k);
  }
  const exp = usedHandoffJti.get(jti);
  if (exp && exp > now) return false; // bereits verwendet und noch nicht abgelaufen
  usedHandoffJti.set(jti, now + ttlMs);
  return true;
}

/** Nutzer-Filter des API-Key-Mandanten (wie /api/external/users). */
function tenantWhere(tenantId: number) {
  return {
    [Op.or]: [
      { companyId: { [Op.in]: literal(`(SELECT id FROM companies WHERE tenant_id = ${tenantId})`) } },
      { tenantId },
    ],
  };
}

export class NfcController {
  /**
   * POST /api/nfc/exchange  { handoff }
   * Prüft den Hub-Handoff, findet den Nutzer über hubPersonId und gibt eine
   * kurzlebige, auf Stempeln begrenzte Sitzung (scope nfc:stamp) zurück.
   */
  async exchange(req: Request, res: Response, next: NextFunction) {
    try {
      const raw = String(req.body?.handoff || '');
      if (!raw) return next(new AppError(400, 'handoff fehlt'));

      let payload;
      try {
        payload = verifyHubHandoff(raw);
      } catch {
        return res.status(401).json({ error: 'INVALID_HANDOFF', message: 'Handoff ungültig oder abgelaufen.' });
      }
      if (payload.act !== 'stamp') {
        return res.status(400).json({ error: 'WRONG_ACTION', message: 'Dieser Handoff ist nicht fürs Stempeln.' });
      }
      if (!payload.pid || typeof payload.pid !== 'string') {
        return res.status(400).json({ error: 'INVALID_HANDOFF', message: 'Handoff ungültig.' });
      }
      // Einmal-Nutzung erzwingen: ein bereits eingelöster Handoff wird abgelehnt (Replay-Schutz).
      if (!payload.jti || !consumeJti(payload.jti)) {
        return res.status(401).json({ error: 'HANDOFF_USED', message: 'Dieser Zugang wurde bereits verwendet. Bitte Chip erneut scannen.' });
      }

      const user = await User.findOne({ where: { hubPersonId: payload.pid } });
      if (!user || !user.isActive) {
        return res.status(404).json({ error: 'UNKNOWN_PERSON', message: 'Kein aktiver Mitarbeiter zu diesem Chip.' });
      }

      const token = jwt.sign(
        { id: user.id, scope: NFC_STAMP_SCOPE, tv: user.tokenVersion ?? 0 },
        process.env.JWT_SECRET as string,
        { expiresIn: `${NFC_SESSION_MINUTES}m` }
      );
      res.json({
        token,
        user: { firstName: user.firstName, lastName: user.lastName },
      });
    } catch (e) {
      return next(e);
    }
  }

  /**
   * GET /api/external/link/users  (Scope link:write, server-zu-server für den Hub)
   * Nutzer des Mandanten inkl. interner ID + employeeNumber (Auto-Vorschlag) + aktueller
   * hubPersonId-Verknüpfung. Bewusst nur unter dem privilegierten link-Scope.
   */
  async linkUsers(req: Request, res: Response, next: NextFunction) {
    try {
      const global = keyIsGlobal(req);
      const qTenant = req.query.tenantId != null && req.query.tenantId !== '' ? Number(req.query.tenantId) : null;
      if (qTenant != null && !global) {
        return next(new AppError(403, 'tenantId erfordert den Scope link:all-tenants'));
      }
      // Scoped-Key: eigener Mandant. Globaler Key: gewählter Mandant oder alle.
      let where: any;
      if (global) {
        where = qTenant != null ? tenantWhere(qTenant) : {};
      } else {
        where = tenantWhere(Number(req.apiTenantId));
      }

      const users = await User.findAll({
        where: { ...where, isActive: true },
        attributes: ['id', 'firstName', 'lastName', 'employeeNumber', 'hubPersonId', 'companyId'],
        order: [['lastName', 'ASC'], ['firstName', 'ASC']],
      });

      // Firmennamen (für Anzeige/Gruppierung) einmalig nachladen.
      const companyIds = Array.from(new Set(users.map((u) => u.companyId).filter((x): x is number => !!x)));
      const companies = companyIds.length
        ? await Company.findAll({ where: { id: companyIds }, attributes: ['id', 'name'] })
        : [];
      const cmap = new Map(companies.map((c) => [c.id, c.name]));

      res.json({
        users: users.map((u) => ({
          id: u.id,
          firstName: u.firstName,
          lastName: u.lastName,
          employeeNumber: u.employeeNumber || null,
          hubPersonId: u.hubPersonId || null,
          companyId: u.companyId || null,
          companyName: u.companyId ? (cmap.get(u.companyId) || null) : null,
        })),
      });
    } catch (e) {
      return next(e);
    }
  }

  /**
   * GET /api/external/link/tenants  (Scope link:all-tenants)
   * Listet alle aktiven Mandanten inkl. ihrer Firmen — für die Mandanten-Auswahl im Hub.
   */
  async listTenants(_req: Request, res: Response, next: NextFunction) {
    try {
      const [tenants, companies] = await Promise.all([
        Tenant.findAll({ where: { isActive: true }, attributes: ['id', 'name'], order: [['name', 'ASC']] }),
        Company.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'tenantId'], order: [['name', 'ASC']] }),
      ]);
      res.json({
        tenants: tenants.map((t) => ({
          id: t.id,
          name: t.name,
          companies: companies.filter((c) => c.tenantId === t.id).map((c) => ({ id: c.id, name: c.name })),
        })),
      });
    } catch (e) {
      return next(e);
    }
  }

  /**
   * GET /api/external/link/pin-required?userId=N  (Scope link:write)
   * Sagt dem Hub, ob die Firma dieses Nutzers vor der NFC-Aktion eine PIN verlangt.
   */
  async pinRequired(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = Number(req.query.userId);
      if (!Number.isInteger(userId) || userId < 1) return next(new AppError(400, 'userId ungültig'));
      const where = keyIsGlobal(req) ? { id: userId } : { id: userId, ...tenantWhere(Number(req.apiTenantId)) };
      const user = await User.findOne({ where });
      if (!user) return next(new AppError(404, 'Nutzer nicht gefunden'));
      let s = user.companyId ? await SystemSettings.findOne({ where: { companyId: user.companyId } }) : null;
      if (!s) s = await SystemSettings.findOne({ where: { companyId: null } });
      res.json({ pinRequired: !!(s && s.nfcPinRequired) });
    } catch (e) {
      return next(e);
    }
  }

  /**
   * POST /api/external/link/assign  (Scope link:write) { userId, hubPersonId|null }
   * Setzt/entfernt die hubPersonId eines Mandanten-Nutzers. Löst bei Setzen eine
   * bestehende Zuordnung derselben hubPersonId auf einen anderen Nutzer.
   */
  async linkAssign(req: Request, res: Response, next: NextFunction) {
    try {
      const userId = Number(req.body?.userId);
      const hubPersonId = req.body?.hubPersonId == null ? null : String(req.body.hubPersonId);
      if (!Number.isInteger(userId) || userId < 1) return next(new AppError(400, 'userId ungültig'));

      const where = keyIsGlobal(req) ? { id: userId } : { id: userId, ...tenantWhere(Number(req.apiTenantId)) };
      const user = await User.findOne({ where });
      if (!user) return next(new AppError(404, 'Nutzer nicht im Mandanten gefunden'));

      if (hubPersonId) {
        // hubPersonId ist eindeutig: eine evtl. bestehende Zuordnung woanders lösen.
        await User.update({ hubPersonId: null }, { where: { hubPersonId, id: { [Op.ne]: user.id } } });
      }
      user.hubPersonId = hubPersonId;
      await user.save();
      res.json({ ok: true, userId: user.id, hubPersonId: user.hubPersonId });
    } catch (e) {
      return next(e);
    }
  }
}
