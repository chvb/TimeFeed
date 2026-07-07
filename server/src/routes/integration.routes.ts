import { Router, Request, Response, NextFunction } from 'express';
import { integrationController } from '../controllers/integration.controller';
import { authenticate } from '../middleware/auth';
import { UserRole } from '../models/User';

const router = Router();

// UrlaubsFeed-Kopplung: Super-Admin oder Admin (tenant-gescopet, Auflösung im Controller).
const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  const u = req.user;
  if (!u) return res.status(401).json({ error: 'Authentication required.', message: 'Authentication required.' });
  if (!u.isSuperAdmin && u.role !== UserRole.ADMIN) {
    return res.status(403).json({ error: 'Not authorized.', message: 'Not authorized.' });
  }
  return next();
};

router.use(authenticate, requireAdmin);

router.get('/urlaubsfeed', integrationController.get);
router.put('/urlaubsfeed', integrationController.put);
router.post('/urlaubsfeed/test', integrationController.test);
router.post('/urlaubsfeed/sync', integrationController.sync);
// Mitarbeiter-Abgleich: Remote-Liste (Vorschau mit Match-Status) + selektiver Import.
router.get('/urlaubsfeed/users', integrationController.listRemoteUsers);
router.post('/urlaubsfeed/import-users', integrationController.importUsers);

export default router;
