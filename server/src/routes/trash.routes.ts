import { Router } from 'express';
import { authenticate, authorizeSuperAdmin } from '../middleware/auth';
import ctrl from '../controllers/trash.controller';

// Papierkorb ist instanzweit (mandanten-/firmenübergreifend) → nur Super-Admin.
const router = Router();

router.get('/', authenticate, authorizeSuperAdmin, ctrl.list);
router.post('/:id/restore', authenticate, authorizeSuperAdmin, ctrl.restore);
// '/all' vor '/:id' registrieren
router.delete('/all', authenticate, authorizeSuperAdmin, ctrl.empty);
router.delete('/:id', authenticate, authorizeSuperAdmin, ctrl.remove);

export default router;
