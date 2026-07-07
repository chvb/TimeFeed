import { Router } from 'express';
import { body } from 'express-validator';
import { SurchargeProfileController } from '../controllers/surchargeProfile.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

/**
 * /api/surcharge-profiles — Zuschlagsprofile (Nachtarbeit u. ä.).
 * Lesen: admin/buchhaltung/verwaltung (für Zuordnungs-Dropdowns),
 * Schreiben: nur admin — gleiches Muster wie timeModel.routes.
 * Die Fenster (windows) validiert der Controller inhaltlich (HH:MM, Lohnart, %).
 */

const router = Router();
const controller = new SurchargeProfileController();

const surchargeValidators = [
  body('isActive').optional().isBoolean(),
  body('windows').optional().isArray(),
];

router.get(
  '/',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG),
  controller.list.bind(controller)
);

router.post(
  '/',
  authenticate,
  authorize(UserRole.ADMIN),
  [body('name').notEmpty().trim().withMessage('Name ist erforderlich'), ...surchargeValidators],
  controller.create.bind(controller)
);

router.put(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  [body('name').optional().notEmpty().trim(), ...surchargeValidators],
  controller.update.bind(controller)
);

router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  controller.remove.bind(controller)
);

export default router;
