import { Router, Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { NfcController } from '../controllers/nfc.controller';
import { TimeController } from '../controllers/time.controller';
import { nfcStampAuth } from '../middleware/nfcStampAuth';
import { reportNfcActionToHub } from '../services/hubHandoff';

const router = Router();
const nfcController = new NfcController();
const timeController = new TimeController();

/**
 * Meldet nach erfolgreichem NFC-Stempeln (2xx) die Aktion ans zentrale Hub-Audit.
 * Läuft über res:finish, damit die bestehende Stempel-Antwort unangetastet bleibt.
 */
function reportStampAction(req: Request, res: Response, next: NextFunction) {
  res.on('finish', () => {
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    const pid = String((req as any).nfcPublicId || '');
    const type = String(req.body?.type || '');
    if (!pid || !type) return;
    const time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Berlin' });
    reportNfcActionToHub(pid, type, time + ' Uhr');
  });
  next();
}

const exchangeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

// Handoff → kurzlebige Stempel-Sitzung.
router.post('/exchange', exchangeLimiter, nfcController.exchange.bind(nfcController));

// Stempel-Sitzung: Status + Stempeln über die BESTEHENDE Logik (GPS-Pflicht,
// Sequenzprüfung, Monatssperre gelten unverändert).
router.get('/status', nfcStampAuth, timeController.status.bind(timeController));
router.post('/stamp', nfcStampAuth, reportStampAction, timeController.stamp.bind(timeController));

export default router;
