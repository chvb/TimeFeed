import { Router } from 'express';
import { apiKeyController } from '../controllers/apiKey.controller';
import { authenticate, authorizeSuperAdmin } from '../middleware/auth';

const router = Router();

// Nur Super-Admin: API-Schlüssel sind instanzweite Infrastruktur.
router.use(authenticate, authorizeSuperAdmin);

router.get('/', apiKeyController.list);
router.post('/', apiKeyController.create);
router.delete('/:id', apiKeyController.revoke);

export default router;
