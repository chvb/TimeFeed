import { Router } from 'express';
import { body } from 'express-validator';
import {
  getDepartments,
  createDepartment,
  updateDepartment,
  deleteDepartment
} from '../controllers/department.controller';
import { authenticate, authorize } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { UserRole } from '../models/User';

const router = Router();

router.use(authenticate);

router.get('/', getDepartments);
router.post(
  '/',
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  [body('name').notEmpty().trim().withMessage('Name ist erforderlich'), body('description').optional().trim()],
  validate,
  createDepartment
);
router.put(
  '/:id',
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  [body('name').optional().notEmpty().trim(), body('description').optional().trim()],
  validate,
  updateDepartment
);
router.delete('/:id', authorize(UserRole.ADMIN), deleteDepartment);

export default router;