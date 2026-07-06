import { Router } from 'express';
import { body } from 'express-validator';
import { UserController } from '../controllers/user.controller';
import { authenticate, authorize } from '../middleware/auth';
import { UserRole } from '../models/User';
import { passwordPolicy } from '../utils/passwordPolicy';

const router = Router();
const userController = new UserController();

router.get(
  '/',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG, UserRole.VERWALTUNG),
  userController.getAllUsers
);

// Mitarbeiter-CSV-Import (Admin/Buchhaltung)
router.post('/import', authenticate, authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG), userController.importUsers);

// Kollegen-Liste aus dem eigenen Team (vor /:id)
router.get('/colleagues', authenticate, userController.getColleagues);

// Geburtstage (Kalender/Feed) – vor /:id
router.get('/birthdays', authenticate, userController.getBirthdays);

router.get(
  '/:id',
  authenticate,
  userController.getUserById
);

router.post(
  '/',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  [
    body('email').isEmail().normalizeEmail(),
    body('password').custom(passwordPolicy),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
    body('role').isIn(Object.values(UserRole)),
  ],
  userController.createUser
);

router.put(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  [
    body('email').optional().isEmail().normalizeEmail(),
    body('firstName').optional().trim(),
    body('lastName').optional().trim(),
    body('role').optional().isIn(Object.values(UserRole)),
    body('groupId').optional({ nullable: true, checkFalsy: true }).isInt(),
  ],
  userController.updateUser
);

router.delete(
  '/:id',
  authenticate,
  authorize(UserRole.ADMIN),
  userController.deleteUser
);

// Neuen Stempel-Code generieren (admin) — z. B. bei Verlust des NFC-Chips.
router.post(
  '/:id/regenerate-stamp-code',
  authenticate,
  authorize(UserRole.ADMIN),
  userController.regenerateStampCode
);

// QR-Badge des Stempel-Codes als PNG zum Ausdrucken (admin).
router.get(
  '/:id/stamp-qr',
  authenticate,
  authorize(UserRole.ADMIN),
  userController.stampQr
);

router.post(
  '/:id/activate',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  userController.activateUser
);

router.post(
  '/:id/deactivate',
  authenticate,
  authorize(UserRole.ADMIN, UserRole.BUCHHALTUNG),
  userController.deactivateUser
);

export default router;
