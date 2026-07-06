import { Router } from 'express';
import { body } from 'express-validator';
import { TerminalController } from '../controllers/terminal.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

// Admin-CRUD für Stempel-Terminals: /api/terminals (Rolle admin, firmen-gescopet).
const router = Router();
const controller = new TerminalController();

const terminalValidators = [
  body('locationLabel').optional({ nullable: true }).isString(),
  body('lat').optional({ nullable: true }).isFloat({ min: -90, max: 90 }).withMessage('lat muss zwischen -90 und 90 liegen'),
  body('lng').optional({ nullable: true }).isFloat({ min: -180, max: 180 }).withMessage('lng muss zwischen -180 und 180 liegen'),
  body('isActive').optional().isBoolean(),
];

router.get(
  '/',
  authenticate,
  authorize(UserRole.ADMIN),
  controller.list.bind(controller)
);

router.post(
  '/',
  authenticate,
  authorize(UserRole.ADMIN),
  [body('name').notEmpty().trim().withMessage('Name ist erforderlich'), ...terminalValidators],
  controller.create.bind(controller)
);

router.put(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  [body('name').optional().notEmpty().trim(), ...terminalValidators],
  controller.update.bind(controller)
);

router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  controller.remove.bind(controller)
);

export default router;
