import { Router } from 'express';
import { brandingController } from '../controllers/branding.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Öffentlich (Login-Seite/PWA-Manifest): nur Brand-Felder, gecacht.
router.get('/public', brandingController.getPublic);
router.get('/icon', brandingController.getIcon);

// Authentifiziert: Branding des eigenen Mandanten.
router.get('/', authenticate, brandingController.getOwn);

export default router;
