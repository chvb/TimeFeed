import { Request, Response, NextFunction } from 'express';
import { Company } from '../models/Company';
import { Tenant } from '../models/Tenant';
import { User, UserRole } from '../models/User';
import { Group } from '../models/Group';
import { AppError } from '../middleware/errorHandler';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';

const toDto = (c: any, userCount?: number) => ({
  id: c.id,
  name: c.name,
  tenantId: c.tenantId ?? null,
  tenantName: c.tenant?.name ?? null,
  logo: c.logo || null,
  bundesland: c.bundesland || null,
  isActive: c.isActive,
  userCount,
  createdAt: c.createdAt,
});

// Mandanten-Admin darf nur Firmen seines Tenants sehen/bearbeiten; Super-Admin alle.
function guardTenant(req: Request, company: any): boolean {
  if (req.user!.isSuperAdmin) return true;
  return !!req.user!.tenantId && company.tenantId === req.user!.tenantId;
}

export class CompanyController {
  // Firmen-Optionen für den Firmen-Wechsler (id+name). Firmenübergreifende Nutzer
  // (Super-Admin sowie Admin/Buchhaltung ohne Firmenbindung) erhalten alle Firmen + canSwitch=true.
  async options(req: Request, res: Response, next: NextFunction) {
    try {
      const u = req.user!;
      const isTenantAdmin = (u.role === UserRole.ADMIN || u.role === UserRole.BUCHHALTUNG) && !!u.tenantId && !u.companyId;
      const cross = !!u.isSuperAdmin || isTenantAdmin || ((u.role === UserRole.ADMIN || u.role === UserRole.BUCHHALTUNG) && !u.companyId && !u.tenantId);
      let companies: any[] = [];
      let tenants: any[] = [];
      if (u.isSuperAdmin || (cross && !isTenantAdmin)) {
        companies = await Company.findAll({ where: { isActive: true }, attributes: ['id', 'name', 'tenantId'], order: [['name', 'ASC']] });
        tenants = await Tenant.findAll({ where: { isActive: true }, attributes: ['id', 'name'], order: [['name', 'ASC']] });
      } else if (isTenantAdmin) {
        companies = await Company.findAll({ where: { isActive: true, tenantId: u.tenantId as number }, attributes: ['id', 'name', 'tenantId'], order: [['name', 'ASC']] });
        tenants = await Tenant.findAll({ where: { id: u.tenantId as number }, attributes: ['id', 'name'] });
      } else if (u.companyId) {
        companies = await Company.findAll({ where: { id: u.companyId }, attributes: ['id', 'name', 'tenantId'] });
      }
      res.json({ companies, tenants, canSwitch: cross });
    } catch (e) { next(e); }
  }

  // Liste der Firmen inkl. Mitarbeiterzahl. Super-Admin: alle; Mandanten-Admin: nur eigener Tenant.
  async list(req: Request, res: Response, next: NextFunction) {
    try {
      const where: any = {};
      if (!req.user!.isSuperAdmin && req.user!.tenantId) where.tenantId = req.user!.tenantId;
      const companies = await Company.findAll({ where, order: [['name', 'ASC']], include: [{ model: Tenant, as: 'tenant', attributes: ['id', 'name'], required: false }] });
      const counts: Record<number, number> = {};
      const grouped: any[] = await User.findAll({
        attributes: ['companyId', [User.sequelize!.fn('COUNT', User.sequelize!.col('id')), 'cnt']],
        group: ['companyId'],
        raw: true,
      });
      grouped.forEach((r: any) => { if (r.companyId != null) counts[r.companyId] = Number(r.cnt); });
      res.json({ companies: companies.map((c) => toDto(c, counts[c.id] || 0)) });
    } catch (e) { next(e); }
  }

  async getById(req: Request, res: Response, next: NextFunction) {
    try {
      const company = await Company.findByPk(req.params.id);
      if (!company || !guardTenant(req, company)) return next(new AppError(404, 'Firma nicht gefunden'));
      res.json(toDto(company));
    } catch (e) { next(e); }
  }

  async create(req: Request, res: Response, next: NextFunction) {
    try {
      const { name, logo, bundesland } = req.body;
      if (!name || !String(name).trim()) return next(new AppError(400, 'Name erforderlich'));
      // Mandanten-Admin: Firma immer im eigenen Tenant; Super-Admin: tenantId frei wählbar.
      const tenantId = req.user!.isSuperAdmin ? (req.body.tenantId ?? null) : (req.user!.tenantId ?? null);
      const company = await Company.create({ name: String(name).trim(), logo: logo || null, bundesland: bundesland || null, tenantId: tenantId ?? null, isActive: true });
      await AuditService.log({ userId: req.user!.id, action: AuditAction.CREATE, category: AuditCategory.SYSTEM, entity: 'Company', entityId: company.id, additionalData: { name: company.name } }, req);
      res.status(201).json(toDto(company, 0));
    } catch (e) { next(e); }
  }

  async update(req: Request, res: Response, next: NextFunction) {
    try {
      const company = await Company.findByPk(req.params.id);
      if (!company || !guardTenant(req, company)) return next(new AppError(404, 'Firma nicht gefunden'));
      const { name, logo, bundesland, isActive } = req.body;
      const updateData: any = {};
      if (name !== undefined) updateData.name = String(name).trim();
      if (logo !== undefined) updateData.logo = logo || null;
      if (bundesland !== undefined) updateData.bundesland = bundesland || null;
      // Tenant-Zuordnung nur durch Super-Admin änderbar.
      if (req.user!.isSuperAdmin && req.body.tenantId !== undefined) updateData.tenantId = req.body.tenantId ?? null;
      if (isActive !== undefined) updateData.isActive = !!isActive;
      await company.update(updateData);
      await AuditService.log({ userId: req.user!.id, action: AuditAction.UPDATE, category: AuditCategory.SYSTEM, entity: 'Company', entityId: company.id, additionalData: { name: company.name } }, req);
      res.json(toDto(company));
    } catch (e) { next(e); }
  }

  // Löschen nur, wenn keine Mitarbeiter/Gruppen mehr zugeordnet sind.
  async remove(req: Request, res: Response, next: NextFunction) {
    try {
      const company = await Company.findByPk(req.params.id);
      if (!company || !guardTenant(req, company)) return next(new AppError(404, 'Firma nicht gefunden'));
      const users = await User.count({ where: { companyId: company.id } });
      const groups = await Group.count({ where: { companyId: company.id } });
      if (users > 0 || groups > 0) {
        return next(new AppError(400, `Firma kann nicht gelöscht werden: ${users} Mitarbeiter, ${groups} Gruppen noch zugeordnet. Bitte zuerst umziehen/entfernen.`));
      }
      const name = company.name;
      await company.destroy();
      await AuditService.log({ userId: req.user!.id, action: AuditAction.DELETE, category: AuditCategory.SYSTEM, entity: 'Company', entityId: Number(req.params.id), additionalData: { name } }, req);
      res.json({ message: 'Firma gelöscht' });
    } catch (e) { next(e); }
  }
}

export const companyController = new CompanyController();
