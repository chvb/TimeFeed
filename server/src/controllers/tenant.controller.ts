import { Request, Response, NextFunction } from 'express';
import { Tenant } from '../models/Tenant';
import { Company } from '../models/Company';
import { User, UserRole } from '../models/User';
import { AppError } from '../middleware/errorHandler';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import { BRAND_COLOR_RE, resolveUserTenantId, validateBrandLogo } from './branding.controller';

const toDto = (t: any, companyCount?: number) => ({
  id: t.id,
  name: t.name,
  isActive: t.isActive,
  brandName: t.brandName ?? null,
  brandColor: t.brandColor ?? null,
  brandLogo: t.brandLogo ?? null,
  companyCount,
  createdAt: t.createdAt,
});

export class TenantController {
  async list(_req: Request, res: Response, next: NextFunction) {
    try {
      const tenants = await Tenant.findAll({ order: [['name', 'ASC']] });
      const counts: Record<number, number> = {};
      const grouped: any[] = await Company.findAll({
        attributes: ['tenantId', [Company.sequelize!.fn('COUNT', Company.sequelize!.col('id')), 'cnt']],
        group: ['tenantId'],
        raw: true,
      });
      grouped.forEach((r: any) => { if (r.tenantId != null) counts[r.tenantId] = Number(r.cnt); });
      res.json({ tenants: tenants.map((t) => toDto(t, counts[t.id] || 0)) });
    } catch (e) { next(e); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = await Tenant.findByPk(req.params.id, {
        include: [{ model: Company, as: 'companies', attributes: ['id', 'name'] }],
      });
      if (!tenant) return next(new AppError(404, 'Mandant nicht gefunden'));
      res.json({ ...toDto(tenant), companies: (tenant as any).companies || [] });
    } catch (e) { next(e); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name } = req.body;
      if (!name || !String(name).trim()) return next(new AppError(400, 'Name erforderlich'));
      const tenant = await Tenant.create({ name: String(name).trim(), isActive: true });
      await AuditService.log({ userId: req.user!.id, action: AuditAction.CREATE, category: AuditCategory.SYSTEM, entity: 'Tenant', entityId: tenant.id, additionalData: { name: tenant.name } }, req);
      res.status(201).json(toDto(tenant, 0));
    } catch (e) { next(e); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = await Tenant.findByPk(req.params.id);
      if (!tenant) return next(new AppError(404, 'Mandant nicht gefunden'));
      const { name, isActive } = req.body;
      const updateData: any = {};
      if (name !== undefined) updateData.name = String(name).trim();
      if (isActive !== undefined) updateData.isActive = !!isActive;
      await tenant.update(updateData);
      await AuditService.log({ userId: req.user!.id, action: AuditAction.UPDATE, category: AuditCategory.SYSTEM, entity: 'Tenant', entityId: tenant.id, additionalData: { name: tenant.name } }, req);
      res.json(toDto(tenant));
    } catch (e) { next(e); }
  }

  /**
   * PUT /api/tenants/:id/branding — Body { brandName?, brandColor?, brandLogo? }.
   * Super-Admin ODER Admin des betreffenden Mandanten. null/'' löscht ein Feld.
   */
  async updateBranding(req: Request, res: Response, next: NextFunction) {
    try {
      const tenantId = Number(req.params.id);
      if (!Number.isInteger(tenantId) || tenantId <= 0) return next(new AppError(400, 'Ungültige Mandanten-ID'));

      const u = req.user!;
      if (!u.isSuperAdmin) {
        const ownTenantId = await resolveUserTenantId(u);
        if (u.role !== UserRole.ADMIN || ownTenantId !== tenantId) {
          return next(new AppError(403, 'Nur Super-Admin oder Admin dieses Mandanten'));
        }
      }

      const tenant = await Tenant.findByPk(tenantId);
      if (!tenant) return next(new AppError(404, 'Mandant nicht gefunden'));

      const updateData: any = {};
      const { brandName, brandColor, brandLogo } = req.body ?? {};
      if (brandName !== undefined) {
        const v = brandName === null ? '' : String(brandName).trim();
        if (v.length > 100) return next(new AppError(400, 'brandName zu lang (max. 100 Zeichen)'));
        updateData.brandName = v || null;
      }
      if (brandColor !== undefined) {
        const v = brandColor === null ? '' : String(brandColor).trim();
        if (v && !BRAND_COLOR_RE.test(v)) return next(new AppError(400, "brandColor muss das Format '#rrggbb' haben"));
        updateData.brandColor = v ? v.toLowerCase() : null;
      }
      if (brandLogo !== undefined) {
        const v = brandLogo === null ? '' : String(brandLogo).trim();
        if (v) validateBrandLogo(v);
        updateData.brandLogo = v || null;
      }

      await tenant.update(updateData);
      await AuditService.log({
        userId: u.id,
        action: AuditAction.UPDATE,
        category: AuditCategory.SYSTEM,
        entity: 'Tenant',
        entityId: tenant.id,
        additionalData: { branding: true, brandName: tenant.brandName, brandColor: tenant.brandColor, brandLogoBytes: tenant.brandLogo?.length ?? 0 },
      }, req);
      res.json({
        tenant: toDto(tenant),
        branding: { brandName: tenant.brandName ?? null, brandColor: tenant.brandColor ?? null, brandLogo: tenant.brandLogo ?? null },
      });
    } catch (e) { next(e); }
  }

  // Löschen nur, wenn keine Firmen mehr zugeordnet sind.
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const tenant = await Tenant.findByPk(req.params.id);
      if (!tenant) return next(new AppError(404, 'Mandant nicht gefunden'));
      const companies = await Company.count({ where: { tenantId: tenant.id } });
      if (companies > 0) {
        return next(new AppError(400, `Mandant kann nicht gelöscht werden: ${companies} Firma(en) noch zugeordnet. Bitte zuerst umziehen/entfernen.`));
      }
      // Auch direkt am Mandanten hängende Nutzer (Mandanten-Admins) verhindern das Löschen,
      // sonst zeigt deren tenantId ins Leere.
      const tenantUsers = await User.count({ where: { tenantId: tenant.id } });
      if (tenantUsers > 0) {
        return next(new AppError(400, `Mandant kann nicht gelöscht werden: ${tenantUsers} Mandanten-Admin(s) noch zugeordnet. Bitte zuerst entfernen/umziehen.`));
      }
      const name = tenant.name;
      await tenant.destroy();
      await AuditService.log({ userId: req.user!.id, action: AuditAction.DELETE, category: AuditCategory.SYSTEM, entity: 'Tenant', entityId: Number(req.params.id), additionalData: { name } }, req);
      res.json({ message: 'Mandant gelöscht' });
    } catch (e) { next(e); }
  }
}

export const tenantController = new TenantController();
