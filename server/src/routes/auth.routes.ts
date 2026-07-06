import { Router } from 'express';
import { body } from 'express-validator';
import { AuthController } from '../controllers/auth.controller';
import { authenticate } from '../middleware/auth';
import { passwordPolicy } from '../utils/passwordPolicy';

const router = Router();
const authController = new AuthController();

router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').custom(passwordPolicy),
    body('firstName').notEmpty().trim(),
    body('lastName').notEmpty().trim(),
  ],
  authController.register
);

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  authController.login
);

router.post('/logout', authenticate, authController.logout);

router.get('/me', authenticate, authController.getCurrentUser);

router.post(
  '/change-password',
  authenticate,
  [
    body('currentPassword').notEmpty(),
    body('newPassword').custom(passwordPolicy),
  ],
  authController.changePassword
);

router.post(
  '/forgot-password',
  [body('email').isEmail().normalizeEmail()],
  authController.forgotPassword
);

router.post(
  '/reset-password',
  [
    body('token').notEmpty(),
    body('newPassword').custom(passwordPolicy),
  ],
  authController.resetPassword
);

export default router;