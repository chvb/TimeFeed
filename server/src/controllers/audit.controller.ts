import { Request, Response, NextFunction } from 'express';
import { Op, fn, col } from 'sequelize';
import { AuditLog, AuditAction, AuditCategory } from '../models/AuditLog';
import { User } from '../models/User';
import { getAccessibleUserIds, getEffectiveActor } from '../services/accessScope';

export class AuditController {
  async getAuditLogs(req: Request, res: Response, next: NextFunction) {
    try {
      const {
        page = 1,
        limit = 50,
        action,
        category,
        userId,
        entity,
        startDate,
        endDate,
        success
      } = req.query;

      // limit/page robust + gedeckelt (DoS-Schutz: kein ?limit=99999999).
      const safeLimit = Math.min(Math.max(parseInt(String(limit), 10) || 50, 1), 200);
      const safePage = Math.max(parseInt(String(page), 10) || 1, 1);
      const offset = (safePage - 1) * safeLimit;
      const where: any = {};

      // Apply filters
      if (action) where.action = action;
      if (category) where.category = category;
      if (userId) where.userId = userId;
      if (entity) where.entity = entity;
      if (success !== undefined) where.success = success === 'true';

      // Firmen-/Mandanten-Scope: nur Audit-Einträge zu Nutzern im eigenen Bereich.
      const accessibleIds = await getAccessibleUserIds(getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId));
      if (accessibleIds !== null) {
        where.userId = userId && accessibleIds.includes(Number(userId)) ? Number(userId) : accessibleIds;
      }

      if (startDate || endDate) {
        where.createdAt = {};
        if (startDate) where.createdAt[Op.gte] = new Date(startDate as string);
        if (endDate) where.createdAt[Op.lte] = new Date(endDate as string);
      }

      const { rows: logs, count } = await AuditLog.findAndCountAll({
        where,
        include: [
          {
            model: User,
            as: 'user',
            attributes: ['id', 'firstName', 'lastName', 'email'],
            required: false
          }
        ],
        order: [['createdAt', 'DESC']],
        limit: safeLimit,
        offset,
      });

      res.json({
        logs,
        pagination: {
          page: safePage,
          limit: safeLimit,
          total: count,
          totalPages: Math.ceil(count / safeLimit)
        }
      });
    } catch (error) {
      next(error);
    }
  }

  async getAuditStats(req: Request, res: Response, next: NextFunction) {
    try {
      const { days = 30 } = req.query;
      const safeDays = Math.min(Math.max(parseInt(String(days), 10) || 30, 1), 366); // max 1 Jahr
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - safeDays);

      // Firmen-/Mandanten-Scope wie bei getAuditLogs (kein Cross-Tenant-Aggregat).
      const accessibleIds = await getAccessibleUserIds(getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId));
      const base: any = { createdAt: { [Op.gte]: startDate } };
      if (accessibleIds !== null) base.userId = accessibleIds;

      const stats = await AuditLog.findAll({
        where: { ...base },
        attributes: [
          'category',
          [fn('COUNT', col('id')), 'count']
        ],
        group: ['category'],
        raw: true
      });

      const actionStats = await AuditLog.findAll({
        where: { ...base },
        attributes: [
          'action',
          [fn('COUNT', col('id')), 'count']
        ],
        group: ['action'],
        raw: true
      });

      const failureStats = await AuditLog.findAll({
        where: { ...base, success: false },
        attributes: [
          'category',
          [fn('COUNT', col('id')), 'count']
        ],
        group: ['category'],
        raw: true
      });

      res.json({
        categoryStats: stats,
        actionStats: actionStats,
        failureStats: failureStats,
        period: `${days} days`
      });
    } catch (error) {
      next(error);
    }
  }

  async getAvailableFilters(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({
        actions: Object.values(AuditAction),
        categories: Object.values(AuditCategory)
      });
    } catch (error) {
      next(error);
    }
  }
}