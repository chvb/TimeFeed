import { Request, Response, NextFunction } from 'express';
import { listTrash, restoreTrashItem, purgeTrashItem, emptyTrash } from '../services/trashService';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import { getEffectiveActor, getManagedCompanyIds } from '../services/accessScope';

// Firmen-/Mandanten-Scope des Akteurs (null = alle Firmen).
const scopeOf = (req: Request) => getManagedCompanyIds(getEffectiveActor(req.user!, req.query.companyId, req.query.tenantId));

export class TrashController {
  list = async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ items: await listTrash(await scopeOf(req)) });
    } catch (e) {
      next(e);
    }
  };

  restore = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const r = await restoreTrashItem(Number(req.params.id), await scopeOf(req));
      await AuditService.log({
        userId: req.user!.id,
        action: AuditAction.IMPORT,
        category: AuditCategory.IMPORT_EXPORT,
        entity: r.entityType,
        additionalData: { restoredFromTrash: r.label },
      }, req);
      res.json({ message: 'Wiederhergestellt', ...r });
    } catch (e) {
      next(e);
    }
  };

  remove = async (req: Request, res: Response, next: NextFunction) => {
    try {
      await purgeTrashItem(Number(req.params.id), await scopeOf(req));
      res.json({ message: 'Endgültig gelöscht' });
    } catch (e) {
      next(e);
    }
  };

  empty = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const count = await emptyTrash(await scopeOf(req));
      res.json({ message: 'Papierkorb geleert', count });
    } catch (e) {
      next(e);
    }
  };
}

export default new TrashController();
