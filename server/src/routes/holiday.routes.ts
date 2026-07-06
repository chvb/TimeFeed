import { Router } from 'express';
import { body } from 'express-validator';
import { HolidayController } from '../controllers/holiday.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

const router = Router();
const holidayController = new HolidayController();

router.get('/', authenticate, holidayController.getAllHolidays);

router.get('/:id', authenticate, holidayController.getHolidayById);

router.post(
  '/',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  [
    body('name').notEmpty().trim(),
    body('date').optional().isISO8601(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    body('type').optional().isIn(['national', 'company']),
    body('isRecurring').optional().isBoolean(),
    body('description').optional().trim(),
  ],
  holidayController.createHoliday
);

router.put(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  [
    body('name').optional().trim(),
    body('date').optional().isISO8601(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    body('type').optional().isIn(['national', 'company']),
    body('isRecurring').optional().isBoolean(),
    body('description').optional().trim(),
  ],
  holidayController.updateHoliday
);

router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  holidayController.deleteHoliday
);

export default router;
