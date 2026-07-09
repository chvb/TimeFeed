import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { NfcController } from '../controllers/nfc.controller';
import { TimeController } from '../controllers/time.controller';
import { nfcStampAuth } from '../middleware/nfcStampAuth';

const router = Router();
const nfcController = new NfcController();
const timeController = new TimeController();

const exchangeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// Handoff → kurzlebige Stempel-Sitzung.
router.post('/exchange', exchangeLimiter, nfcController.exchange.bind(nfcController));

// Stempel-Sitzung: Status + Stempeln über die BESTEHENDE Logik (GPS-Pflicht,
// Sequenzprüfung, Monatssperre gelten unverändert).
router.get('/status', nfcStampAuth, timeController.status.bind(timeController));
router.post('/stamp', nfcStampAuth, timeController.stamp.bind(timeController));

export default router;
