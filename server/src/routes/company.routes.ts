import { Router } from 'express';
import { companyController } from '../controllers/company.controller';
import { authenticate, authorizeCompanyManager } from '../middleware/auth';

const router = Router();

// Firmen-Optionen für den Wechsler – für alle authentifizierten Nutzer (eigene/erlaubte Firmen).
router.get('/options', authenticate, companyController.options);

// Firmen-Verwaltung – Super-Admin ODER Mandanten-Admin (auf eigenen Tenant gescopet).
router.use(authenticate, authorizeCompanyManager);

router.get('/', companyController.list);
router.get('/:id', companyController.getById);
router.post('/', companyController.create);
router.put('/:id', companyController.update);
router.delete('/:id', companyController.remove);

export default router;
