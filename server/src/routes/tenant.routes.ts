import { Router } from 'express';
import { tenantController } from '../controllers/tenant.controller';
import { authenticate, authorizeSuperAdmin } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// Branding: Super-Admin ODER Admin des betreffenden Mandanten (Prüfung im Controller).
router.put('/:id/branding', (req, res, next) => tenantController.updateBranding(req, res, next));
// Zentrales Kiosk-Einstellungs-Passwort (gleiche Auth wie Branding).
router.put('/:id/terminal-settings-password', (req, res, next) => tenantController.updateTerminalSettingsPassword(req, res, next));

// Mandanten-/Tenant-Verwaltung – ausschließlich Super-Admin.
router.use(authorizeSuperAdmin);

router.get('/', tenantController.list);
router.get('/:id', tenantController.getById);
router.post('/', tenantController.create);
router.put('/:id', tenantController.update);
router.delete('/:id', tenantController.remove);

export default router;
