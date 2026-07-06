import { Router } from 'express';
import { body } from 'express-validator';
import { authenticate, authorize, authorizeSuperAdmin } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { UserRole } from '../models/User';
import { EmailSettings } from '../models/EmailSettings';
import emailService from '../services/emailService';
import { SettingsController } from '../controllers/settings.controller';

const router = Router();
const settingsController = new SettingsController();

// Typ-Validierung der Settings-Felder (Tippfehler/Fehl-Typen → 400 statt 500).
const settingsValidators = [
  ...['hoursPerWorkday', 'passwordMinLength', 'sessionDurationHours',
    'passwordExpiryDays', 'maxLoginAttempts', 'lockoutDurationMinutes',
    'breakAfter6hMinutes', 'breakAfter9hMinutes', 'arbzgMaxDailyMinutes', 'arbzgMinRestMinutes',
  ].map((f) => body(f).optional().isInt({ min: 0 }).withMessage(`${f} muss eine ganze Zahl ≥ 0 sein`)),
  ...['emailNotifications', 'passwordRequireUppercase',
    'passwordRequireLowercase', 'passwordRequireNumbers', 'passwordRequireSpecialChars',
    'autoCapEnabled', 'arbzgWarningsEnabled', 'gpsRequired',
  ].map((f) => body(f).optional().isBoolean().withMessage(`${f} muss boolean sein`)),
  body('breakMode').optional().isIn(['auto', 'manual', 'combined']).withMessage('breakMode muss auto|manual|combined sein'),
  body('autoCapTime').optional().matches(/^([01]\d|2[0-3]):[0-5]\d$/).withMessage('autoCapTime muss HH:MM sein'),
  body('workingDays').optional().isArray(),
  body('departments').optional().isArray(),
  body('companyEmail').optional({ checkFalsy: true }).isEmail(),
];

router.get('/', authenticate, authorize(UserRole.ADMIN), settingsController.getSettings.bind(settingsController));
router.put('/', authenticate, authorize(UserRole.ADMIN), settingsValidators, validate, settingsController.updateSettings.bind(settingsController));
router.post('/refresh-holidays', authenticate, authorize(UserRole.ADMIN), settingsController.refreshHolidays.bind(settingsController));

// Email settings routes
router.get(
  '/email',
  authenticate,
  authorizeSuperAdmin,
  async (_req, res) => {
    try {
      const emailSettings = await EmailSettings.findOne();
      if (emailSettings) {
        // Don't expose password in response
        const { smtpPassword: _smtpPassword, ...safeSettings } = emailSettings.toJSON();
        return res.json(safeSettings);
      } else {
        return res.json({
          smtpHost: '',
          smtpPort: 587,
          smtpUser: '',
          smtpSecure: false,
          fromEmail: '',
          fromName: 'TimeFeed',
          isActive: false
        });
      }
    } catch (error) {
      console.error('Error fetching email settings:', error);
      return res.status(500).json({ message: 'Error fetching email settings' });
    }
  }
);

router.put(
  '/email',
  authenticate,
  authorizeSuperAdmin,
  async (req, res) => {
    try {
      const { smtpHost, smtpPort, smtpUser, smtpPassword, smtpSecure, fromEmail, fromName, isActive } = req.body;
      
      let emailSettings = await EmailSettings.findOne();
      
      const settingsData = {
        smtpHost,
        smtpPort,
        smtpUser,
        smtpSecure,
        fromEmail,
        fromName,
        isActive
      };

      // Only update password if provided
      if (smtpPassword && smtpPassword.trim() !== '') {
        (settingsData as any).smtpPassword = smtpPassword;
      }

      if (emailSettings) {
        await emailSettings.update(settingsData);
      } else {
        // For new settings, password is required
        if (!smtpPassword || smtpPassword.trim() === '') {
          return res.status(400).json({ message: 'SMTP password is required for new configuration' });
        }
        emailSettings = await EmailSettings.create({
          ...settingsData,
          smtpPassword
        });
      }

      // Clear cached transporter to force recreation with new settings
      if ((emailService as any).transporter) {
        (emailService as any).transporter = null;
      }

      return res.json({ message: 'Email settings saved successfully' });
    } catch (error) {
      console.error('Error saving email settings:', error);
      return res.status(500).json({ message: 'Error saving email settings' });
    }
  }
);

router.post(
  '/email/test',
  authenticate,
  authorizeSuperAdmin,
  async (req, res) => {
    try {
      const { email } = req.body;
      
      if (!email) {
        return res.status(400).json({ message: 'Email address is required' });
      }

      const emailSettings = await EmailSettings.findOne();
      if (!emailSettings || !emailSettings.isActive) {
        return res.status(400).json({ message: 'Email settings not configured or inactive' });
      }

      await emailService.sendTestEmail(email);
      return res.json({ message: 'Test email sent successfully' });
    } catch (error) {
      console.error('Error sending test email:', error);
      return res.status(500).json({ message: 'Failed to send test email' });
    }
  }
);

export default router;