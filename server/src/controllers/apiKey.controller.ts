import { Request, Response, NextFunction } from 'express';
import { ApiKey, API_DEFAULT_SCOPES, API_ALL_SCOPES, generateApiKey, hashApiKey } from '../models/ApiKey';
import { Tenant } from '../models/Tenant';
import { Company } from '../models/Company';
import { User } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';

// DTO ohne keyHash – der Hash verlässt den Server nie.
const toDto = (k: any) => ({
  id: k.id,
  tenantId: k.tenantId,
  tenantName: k.tenant?.name,
  name: k.name,
  keyPrefix: k.keyPrefix,
  scopes: Array.isArray(k.scopes) ? k.scopes : [],
  isActive: k.isActive,
  lastUsedAt: k.lastUsedAt,
  expiresAt: k.expiresAt,
  createdBy: k.createdBy ? { id: k.createdBy.id, firstName: k.createdBy.firstName, lastName: k.createdBy.lastName } : null,
  createdAt: k.createdAt,
});

/**
 * Mandanten-Scope des Akteurs auflösen (Route ist mit authorizeCompanyManager geschützt):
 * - Mandanten-Admin: immer der eigene Tenant (requested wird ignoriert bzw. muss passen).
 * - Super-Admin: darf den Tenant frei wählen (Pflichtangabe beim Erzeugen).
 */
function resolveTenantId(req: Request, requested?: any): number | null {
  const u = req.user!;
  if (u.tenantId) return u.tenantId;
  const t = requested != null && requested !== '' ? Number(requested) : NaN;
  return Number.isNaN(t) ? null : t;
}

export class ApiKeyController {
  // Liste aller Schlüssel im eigenen Scope (ohne Hash, mit Prefix).
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const where: any = {};
      const scopedTenantId = resolveTenantId(req, req.query.tenantId);
      if (scopedTenantId) where.tenantId = scopedTenantId;
      const keys = await ApiKey.findAll({
        where,
        include: [
          { model: Tenant, as: 'tenant', attributes: ['id', 'name'] },
          { model: User, as: 'createdBy', attributes: ['id', 'firstName', 'lastName'] },
        ],
        order: [['createdAt', 'DESC']],
      });
      res.json({ apiKeys: keys.map(toDto) });
    } catch (e) { next(e); }
  }

  // Neuen Schlüssel erzeugen. Der Vollschlüssel wird NUR in dieser Antwort ausgegeben.
  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, expiresAt } = req.body;
      if (!name || !String(name).trim()) return next(new AppError(400, 'Name erforderlich'));

      // Mandant auflösen: eigener Tenant → explizite Angabe → Tenant der eigenen
      // Firma → einziger vorhandener Mandant (typischer Selfhost-Fall). Erst wenn
      // all das fehlschlägt (mehrere Mandanten, kein Kontext) ist die Angabe Pflicht.
      let tenantId = resolveTenantId(req, req.body.tenantId);
      if (!tenantId && req.user!.companyId) {
        const company = await Company.findByPk(req.user!.companyId, { attributes: ['id', 'tenantId'] });
        tenantId = company?.tenantId ?? null;
      }
      if (!tenantId) {
        const tenants = await Tenant.findAll({ attributes: ['id'], limit: 2 });
        if (tenants.length === 1) tenantId = tenants[0].id;
      }
      if (!tenantId) return next(new AppError(400, 'tenantId erforderlich (bitte oben im Kopf-Wechsler einen Mandanten wählen)'));
      const tenant = await Tenant.findByPk(tenantId);
      if (!tenant) return next(new AppError(404, 'Mandant nicht gefunden'));

      let expires: Date | null = null;
      if (expiresAt) {
        expires = new Date(expiresAt);
        if (Number.isNaN(expires.getTime())) return next(new AppError(400, 'Ungültiges Ablaufdatum'));
      }

      // Optionale Scope-Wahl (nur bekannte Scopes); ohne Angabe die Lese-Defaults.
      const requested: string[] = Array.isArray(req.body.scopes)
        ? req.body.scopes.filter((s: unknown): s is string => typeof s === 'string' && API_ALL_SCOPES.includes(s))
        : [];
      const scopes = requested.length ? Array.from(new Set(requested)) : [...API_DEFAULT_SCOPES];

      const fullKey = generateApiKey();
      const apiKey = await ApiKey.create({
        tenantId,
        name: String(name).trim(),
        keyPrefix: fullKey.slice(0, 8),
        keyHash: hashApiKey(fullKey),
        scopes,
        isActive: true,
        expiresAt: expires,
        createdById: req.user!.id,
      });

      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.CREATE,
        category: AuditCategory.SECURITY,
        entity: 'ApiKey',
        entityId: apiKey.id,
        additionalData: { name: apiKey.name, tenantId, keyPrefix: apiKey.keyPrefix, scopes: apiKey.scopes },
      }, req);

      // key = Vollschlüssel, einmalig; danach ist nur noch keyPrefix sichtbar.
      res.status(201).json({ apiKey: toDto({ ...apiKey.get(), tenant: { name: tenant.name } }), key: fullKey });
    } catch (e) { next(e); }
  }

  // Widerrufen (isActive=false). Bewusst kein Hard-Delete: Prefix + Audit-Spur bleiben nachvollziehbar.
  async revoke(req: Request, res: Response, next: NextFunction) {
    try {
      const apiKey = await ApiKey.findByPk(req.params.id);
      if (!apiKey) return next(new AppError(404, 'API-Schlüssel nicht gefunden'));
      const u = req.user!;
      if (u.tenantId && apiKey.tenantId !== u.tenantId) {
        return next(new AppError(403, 'API-Schlüssel liegt außerhalb Ihres Mandanten'));
      }
      if (apiKey.isActive) {
        await apiKey.update({ isActive: false });
        await AuditService.log({
          userId: u.id,
          action: AuditAction.UPDATE,
          category: AuditCategory.SECURITY,
          entity: 'ApiKey',
          entityId: apiKey.id,
          additionalData: { name: apiKey.name, keyPrefix: apiKey.keyPrefix, revoked: true },
        }, req);
      }
      res.json({ apiKey: toDto(apiKey), message: 'API-Schlüssel widerrufen' });
    } catch (e) { next(e); }
  }
}

export const apiKeyController = new ApiKeyController();
