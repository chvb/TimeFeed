import { Router } from 'express';
import { CorrectionController } from '../controllers/correction.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

const router = Router();
const controller = new CorrectionController();

router.use(authenticate);

// Mitarbeiter stellt einen Antrag für sich selbst (jede Rolle darf das).
router.post('/', controller.create.bind(controller));

// Liste: Mitarbeiter sehen eigene, Verwalter-Rollen ihren accessScope (im Controller).
router.get('/', controller.list.bind(controller));

// Entscheidung nur durch admin/buchhaltung/verwaltung (Reichweite prüft accessScope).
router.post('/:id/approve', authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG), controller.approve.bind(controller));
router.post('/:id/reject', authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG), controller.reject.bind(controller));

export default router;
