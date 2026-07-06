import { Router } from 'express';
import { tenantController } from '../controllers/tenant.controller';
import { authenticate, authorizeSuperAdmin } from '../middleware/auth';

const router = Router();

// Mandanten-/Tenant-Verwaltung – ausschließlich Super-Admin.
router.use(authenticate, authorizeSuperAdmin);

router.get('/', tenantController.list);
router.get('/:id', tenantController.getById);
router.post('/', tenantController.create);
router.put('/:id', tenantController.update);
router.delete('/:id', tenantController.remove);

export default router;
