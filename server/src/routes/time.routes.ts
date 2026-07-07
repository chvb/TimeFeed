import { Router } from 'express';
import { TimeController } from '../controllers/time.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

const router = Router();
const timeController = new TimeController();

// Alle Zeit-Endpunkte erfordern Login; Rechte auf fremde Nutzer prüft der
// Controller über accessScope (admin/buchhaltung/verwaltung im Scope).
router.use(authenticate);

router.post('/stamp', timeController.stamp.bind(timeController));
router.get('/status', timeController.status.bind(timeController));
router.get('/entries', timeController.entries.bind(timeController));
router.get('/days', timeController.days.bind(timeController));
router.get('/balance', timeController.balance.bind(timeController));

// Verwaltung & Buchhaltung (Phase 4). Reichweite prüft der Controller (accessScope);
// Mitarbeiter dürfen auch EIGENE Einträge nicht nachbuchen/stornieren (Rollen-Gate).
const manage = authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG);
router.post('/manual', manage, timeController.manual.bind(timeController));
router.post('/entries/:id/cancel', manage, timeController.cancelEntry.bind(timeController));
// Manuelle Tages-Abwesenheit (Katalog-Key setzen/entfernen, 423 bei Abschluss).
router.put('/days/:userId/:date/absence', manage, timeController.setDayAbsence.bind(timeController));
router.get('/month-overview', manage, timeController.monthOverview.bind(timeController));
router.get('/presence', manage, timeController.presence.bind(timeController));
// Monatsabschluss nur buchhaltung+admin; Wiedereröffnung nur admin.
router.post('/close-month', authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG), timeController.closeMonth.bind(timeController));
router.post('/reopen-month', authorize(UserRole.ADMIN), timeController.reopenMonth.bind(timeController));

export default router;
