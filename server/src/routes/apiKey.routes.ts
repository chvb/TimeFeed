import { Router } from 'express';
import { apiKeyController } from '../controllers/apiKey.controller';
import { authenticate, authorizeCompanyManager } from '../middleware/auth';

const router = Router();

// API-Schlüssel-Verwaltung: Super-Admin oder Mandanten-Admin (tenant-gescopet).
router.use(authenticate, authorizeCompanyManager);

router.get('/', apiKeyController.list);
router.post('/', apiKeyController.create);
router.delete('/:id', apiKeyController.revoke);

export default router;
