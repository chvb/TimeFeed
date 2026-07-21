import { Router } from 'express';
import { body } from 'express-validator';
import { GroupController } from '../controllers/group.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';

const router = Router();
const groupController = new GroupController();

// Lesen nur für Verwalter-Rollen (wie /:id/members) — sonst läse jeder Mitarbeiter
// firmenweit alle Gruppen inkl. Kollegen-E-Mails und -Rollen.
router.get('/', authenticate, authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG), groupController.getAllGroups);

router.get('/:id', authenticate, authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG), groupController.getGroupById);

router.post(
  '/',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  [
    body('name').notEmpty().trim(),
    body('description').optional().trim(),
    body('managerId').optional().isInt(),
    body('parentGroupId').optional().isInt(),
  ],
  groupController.createGroup
);

router.put(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG),
  [
    body('name').optional().trim(),
    body('description').optional().trim(),
    body('managerId').optional().isInt(),
    body('managerIds').optional().isArray(),
    body('managerIds.*').optional().isInt(),
    body('parentGroupId').optional().isInt(),
  ],
  groupController.updateGroup
);

router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  groupController.deleteGroup
);

router.get('/:id/members', authenticate, authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG), groupController.getGroupMembers);

router.post(
  '/:id/members',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  [body('userId').isInt()],
  groupController.addGroupMember
);

router.delete(
  '/:id/members/:userId',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  groupController.removeGroupMember
);

export default router;