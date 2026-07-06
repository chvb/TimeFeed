import { Router } from 'express';
import { body } from 'express-validator';
import { TimeModelController } from '../controllers/timeModel.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

const router = Router();
const controller = new TimeModelController();

const timeModelValidators = [
  ...['monMinutes', 'tueMinutes', 'wedMinutes', 'thuMinutes', 'friMinutes', 'satMinutes', 'sunMinutes']
    .map((f) => body(f).optional().isInt({ min: 0, max: 1440 }).withMessage(`${f} muss zwischen 0 und 1440 liegen`)),
  body('roundingMode').optional().isIn(['none', 'up', 'down', 'nearest']),
  body('roundingMinutes').optional().isInt({ min: 0, max: 60 }),
  body('isActive').optional().isBoolean(),
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
  [body('name').notEmpty().trim().withMessage('Name ist erforderlich'), ...timeModelValidators],
  controller.create.bind(controller)
);

router.put(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  [body('name').optional().notEmpty().trim(), ...timeModelValidators],
  controller.update.bind(controller)
);

router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  controller.remove.bind(controller)
);

export default router;
