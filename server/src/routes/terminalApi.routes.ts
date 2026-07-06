import { Router } from 'express';
import { TerminalApiController } from '../controllers/terminalApi.controller';
import { terminalAuth } from '../middleware/terminalAuth';

// Kiosk-API: /api/terminal — Geräte-Token-Auth (X-Terminal-Token), KEIN User-JWT.
const router = Router();
const controller = new TerminalApiController();

router.get('/info', terminalAuth, controller.info.bind(controller));
router.post('/identify', terminalAuth, controller.identify.bind(controller));
router.post('/stamp', terminalAuth, controller.stamp.bind(controller));

export default router;
