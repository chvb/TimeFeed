import { Request, Response, NextFunction } from 'express';
import { validationResult } from 'express-validator';
import * as jwt from 'jsonwebtoken';
import * as crypto from 'crypto';
import { Op } from 'sequelize';
import { User, UserRole } from '../models/User';
import { Company } from '../models/Company';
import { SystemSettings } from '../models/SystemSettings';
import { PasswordResetToken } from '../models/PasswordResetToken';
import { AppError } from '../middleware/errorHandler';
import emailService from '../services/emailService';
import { AuditService } from '../services/auditService';
import { AuditAction, AuditCategory } from '../models/AuditLog';
import { userAttributeExcludes } from './user.controller';

/**
 * Gültigkeitsdauer des JWT (Stunden) — konfigurierbar über die Einstellungen
 * (SystemSettings.sessionDurationHours): erst die firmenspezifische Zeile, sonst
 * die globale Vorlage (companyId=null, vom Super-Admin gepflegt). Nur lesend, damit
 * der Login-Pfad keine Settings-Zeilen anlegt. Sinnvolle Grenzen: 1 h … 90 Tage;
 * Fallback 8 h, falls (noch) keine Einstellung existiert.
 */
async function resolveSessionHours(companyId: number | null): Promise<number> {
  let settings = companyId
    ? await SystemSettings.findOne({ where: { companyId } })
    : null;
  if (!settings) settings = await SystemSettings.findOne({ where: { companyId: null } });
  const hours = settings?.sessionDurationHours;
  if (!hours || !Number.isFinite(hours) || hours < 1) return 8;
  return Math.min(hours, 24 * 90);
}

export class AuthController {
  async register(req: Request, res: Response, next: NextFunction) {
    try {
      // Öffentliche Selbstregistrierung ist standardmäßig deaktiviert (sonst kann
      // jeder Anonyme unbegrenzt aktive Accounts anlegen). Mitarbeiter legt ein
      // Admin/Buchhaltung über /api/users an. Per ALLOW_SELF_REGISTRATION=true aktivierbar.
      if (process.env.ALLOW_SELF_REGISTRATION !== 'true') {
        return next(new AppError(403, 'Selbstregistrierung ist deaktiviert. Bitte wende dich an einen Administrator.'));
      }

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      // Rolle NIEMALS aus dem Request-Body übernehmen (sonst Self-Register
      // als Admin möglich). Selbstregistrierung erzeugt immer 'mitarbeiter';
      // privilegierte Rollen vergibt nur ein Admin/Buchhaltung über /api/users.
      const { email, password, firstName, lastName } = req.body;

      const existingUser = await User.findOne({ where: { email } });
      if (existingUser) {
        return next(new AppError(400, 'Email already registered'));
      }

      const user = await User.create({
        email,
        password,
        firstName,
        lastName,
        role: UserRole.MITARBEITER,
        isActive: true,
        startDate: new Date(),
      });

      const tokenPayload = { id: user.id, email: user.email, role: user.role };
      const secret = process.env.JWT_SECRET as string;
      const expiresIn = `${await resolveSessionHours(user.companyId ?? null)}h`;

      const token = jwt.sign(tokenPayload, secret, { expiresIn } as jwt.SignOptions);

      res.status(201).json({
        message: 'User registered successfully',
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  async login(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email, password } = req.body;

      const user = await User.findOne({ where: { email } });
      if (!user || !user.isActive) {
        return next(new AppError(401, 'Invalid credentials'));
      }

      const isPasswordValid = await user.comparePassword(password);
      if (!isPasswordValid) {
        await AuditService.logLogin(user.id, false, req, 'Invalid password');
        return next(new AppError(401, 'Invalid credentials'));
      }

      await AuditService.logLogin(user.id, true, req);

      const tokenPayload = { id: user.id, email: user.email, role: user.role };
      const secret = process.env.JWT_SECRET as string;
      const expiresIn = `${await resolveSessionHours(user.companyId ?? null)}h`;

      const token = jwt.sign(tokenPayload, secret, { expiresIn } as jwt.SignOptions);

      res.json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          isSuperAdmin: !!user.isSuperAdmin,
          companyId: user.companyId ?? null,
          tenantId: user.tenantId ?? null,
        },
      });
    } catch (error) {
      return next(error);
    }
  }

  async logout(_req: Request, res: Response, next: NextFunction) {
    try {
      res.json({ message: 'Logout successful' });
    } catch (error) {
      return next(error);
    }
  }

  async getCurrentUser(req: Request, res: Response, next: NextFunction) {
    try {
      const user = await User.findByPk(req.user!.id, {
        attributes: { exclude: userAttributeExcludes(req.user!) },
        include: [{ model: Company, as: 'company', attributes: ['id', 'name', 'logo'], required: false }],
      });

      if (!user) {
        return next(new AppError(404, 'User not found'));
      }

      res.json({ user });
    } catch (error) {
      return next(error);
    }
  }

  async changePassword(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { currentPassword, newPassword } = req.body;
      const user = await User.findByPk(req.user!.id);

      if (!user) {
        return next(new AppError(404, 'User not found'));
      }

      const isPasswordValid = await user.comparePassword(currentPassword);
      if (!isPasswordValid) {
        return next(new AppError(401, 'Current password is incorrect'));
      }

      user.password = newPassword;
      await user.save();

      await AuditService.logPasswordChange(user.id, req);

      res.json({ message: 'Password changed successfully' });
    } catch (error) {
      return next(error);
    }
  }

  async forgotPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { email } = req.body;
      const user = await User.findOne({ where: { email } });

      if (!user || !user.isActive) {
        // Always return success to prevent user enumeration
        return res.json({ message: 'If the email exists, a reset link has been sent' });
      }

      // Generate secure reset token
      const resetToken = crypto.randomBytes(32).toString('hex');
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 1); // Token expires in 1 hour

      // Clean up any existing tokens for this user
      await PasswordResetToken.destroy({
        where: { userId: user.id }
      });

      // Create new reset token
      await PasswordResetToken.create({
        userId: user.id,
        token: resetToken,
        expiresAt
      });

      // Send reset email
      try {
        await emailService.sendPasswordReset(user.email, resetToken);
      } catch (emailError) {
        console.error('Failed to send password reset email:', emailError);
        // Continue to return success to prevent information leakage
      }

      return res.json({ 
        message: 'If the email exists, a reset link has been sent'
      });
    } catch (error) {
      return next(error);
    }
  }

  async resetPassword(req: Request, res: Response, next: NextFunction) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { token, newPassword } = req.body;

      // Find valid, unused token
      const resetToken = await PasswordResetToken.findOne({
        where: {
          token,
          used: false,
          expiresAt: {
            [Op.gt]: new Date()
          }
        }
      });

      if (!resetToken) {
        return next(new AppError(400, 'Invalid or expired reset token'));
      }

      // Token ATOMAR als benutzt markieren (bedingtes Update) – nur der erste von zwei
      // parallelen Requests mit demselben Token gewinnt (echte Einmaligkeit).
      const [claimed] = await PasswordResetToken.update(
        { used: true },
        { where: { id: resetToken.id, used: false } },
      );
      if (!claimed) {
        return next(new AppError(400, 'Invalid or expired reset token'));
      }

      // Find user
      const user = await User.findByPk(resetToken.userId);
      if (!user || !user.isActive) {
        return next(new AppError(400, 'User not found or inactive'));
      }

      // Update password (Token wurde bereits oben atomar entwertet)
      user.password = newPassword;
      await user.save();

      await AuditService.log({
        userId: user.id,
        action: AuditAction.PASSWORD_RESET,
        category: AuditCategory.SECURITY,
        additionalData: { via: 'reset-token' },
      }, req);

      return res.json({ message: 'Password reset successfully' });
    } catch (error) {
      return next(error);
    }
  }
}