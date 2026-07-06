import * as nodemailer from 'nodemailer';
import { EmailSettings } from '../models/EmailSettings';
import { copyrightYears } from '../utils/copyright';

// HTML-Escaping für in E-Mail-Templates interpolierte Nutzerdaten (Namen etc.).
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

class EmailService {
  private transporter: nodemailer.Transporter | null = null;

  async getTransporter(): Promise<nodemailer.Transporter> {
    if (!this.transporter) {
      const settings = await EmailSettings.findOne();
      
      if (!settings || !settings.isActive) {
        throw new Error('Email settings not configured or inactive');
      }

      // Configure transporter based on port and security settings
      const transporterConfig: any = {
        host: settings.smtpHost,
        port: settings.smtpPort || 587,
        secure: settings.smtpSecure || false,
        auth: {
          user: settings.smtpUser,
          pass: settings.smtpPassword
        }
      };

      // For STARTTLS (typically port 587), ensure secure is false
      if (settings.smtpPort === 587 && settings.smtpSecure === true) {
        (transporterConfig as any).secure = false;
      }

      // STARTTLS: Server-Zertifikat validieren (vorher deaktiviert → MITM-Risiko).
      if (!settings.smtpSecure) {
        (transporterConfig as any).tls = {
          rejectUnauthorized: true
        };
      }

      this.transporter = nodemailer.createTransport(transporterConfig);
    }

    return this.transporter;
  }

  async sendEmail(to: string | string[], subject: string, html: string, text?: string, attachments?: Array<{filename: string; content: string | Buffer; contentType?: string}>, fromName?: string): Promise<any> {
    try {
      const transporter = await this.getTransporter();
      const settings = await EmailSettings.findOne();

      if (!settings) {
        throw new Error('Email settings not found');
      }

      const mailOptions = {
        from: `${fromName || settings.fromName} <${settings.fromEmail}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject,
        html,
        text: text || html.replace(/<[^>]*>/g, ''), // Strip HTML for text version
        attachments: attachments?.map(attachment => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType
        }))
      };

      const result = await transporter.sendMail(mailOptions);
      return result;
    } catch (error) {
      console.error('Email sending failed:', error);
      throw error;
    }
  }

  async sendPasswordReset(email: string, resetToken: string): Promise<any> {
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:3031'}/reset-password?token=${resetToken}`;
    
    const subject = 'Passwort zurücksetzen - TimeFeed';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px;">
        <!-- Header with Logo -->
        <div style="text-align: center; margin-bottom: 30px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); padding: 30px; border-radius: 12px;">
          <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 10px;">
            <!-- TimeFeed Logo SVG -->
            <svg width="60" height="60" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 15px;">
              <rect x="8" y="8" width="48" height="48" rx="8" fill="white"/>
              <rect x="14" y="16" width="36" height="32" rx="3" fill="#10B981"/>
              <rect x="14" y="16" width="36" height="8" rx="3" fill="#059669"/>
              <circle cx="22" cy="12" r="2" fill="#6B7280"/>
              <circle cx="32" cy="12" r="2" fill="#6B7280"/>
              <circle cx="42" cy="12" r="2" fill="#6B7280"/>
              <text x="32" y="22" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="5" font-weight="bold">U</text>
            </svg>
            <div style="color: white; font-size: 32px; font-weight: bold; font-family: Arial, sans-serif;">
              <div>Time</div>
              <div style="margin-top: -8px; opacity: 0.9;">Feed</div>
            </div>
          </div>
        </div>
        
        <h2 style="color: #10B981; text-align: center; margin-bottom: 20px;">Passwort zurücksetzen</h2>
        
        <p style="color: #374151; line-height: 1.6; font-size: 16px;">Sie haben eine Passwort-Zurücksetzung für Ihr TimeFeed-Konto angefordert.</p>
        
        <p style="color: #374151; line-height: 1.6; font-size: 16px;">Klicken Sie auf den folgenden Link, um Ihr Passwort zurückzusetzen:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <a href="${resetUrl}" 
             style="display: inline-block; background-color: #10B981; color: white; padding: 15px 30px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px; box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);">
            🔑 Passwort zurücksetzen
          </a>
        </div>
        
        <p style="color: #374151; line-height: 1.6; font-size: 14px;">Oder kopieren Sie diesen Link in Ihren Browser:</p>
        <p style="background-color: #F3F4F6; padding: 15px; border-radius: 8px; word-break: break-all; font-family: monospace; font-size: 12px; border-left: 4px solid #10B981;">
          ${resetUrl}
        </p>
        
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
        
        <p style="color: #6B7280; font-size: 14px; text-align: center;">
          Dieser Link ist 1 Stunde gültig. Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.
        </p>
        
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
          <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
            Diese E-Mail wurde von TimeFeed gesendet.<br>
            © ${copyrightYears()} TimeFeed
          </p>
        </div>
      </div>
    `;

    return await this.sendEmail(email, subject, html);
  }

  async sendTestEmail(email: string): Promise<any> {
    const subject = 'TimeFeed Test-E-Mail';
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; padding: 20px;">
        <!-- Header with Logo -->
        <div style="text-align: center; margin-bottom: 30px; background: linear-gradient(135deg, #10B981 0%, #059669 100%); padding: 30px; border-radius: 12px;">
          <div style="display: flex; align-items: center; justify-content: center; margin-bottom: 10px;">
            <!-- TimeFeed Logo SVG -->
            <svg width="60" height="60" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" style="margin-right: 15px;">
              <rect x="8" y="8" width="48" height="48" rx="8" fill="white"/>
              <rect x="14" y="16" width="36" height="32" rx="3" fill="#10B981"/>
              <rect x="14" y="16" width="36" height="8" rx="3" fill="#059669"/>
              <circle cx="22" cy="12" r="2" fill="#6B7280"/>
              <circle cx="32" cy="12" r="2" fill="#6B7280"/>
              <circle cx="42" cy="12" r="2" fill="#6B7280"/>
              <text x="32" y="22" text-anchor="middle" fill="white" font-family="Arial, sans-serif" font-size="5" font-weight="bold">U</text>
            </svg>
            <div style="color: white; font-size: 32px; font-weight: bold; font-family: Arial, sans-serif;">
              <div>Time</div>
              <div style="margin-top: -8px; opacity: 0.9;">Feed</div>
            </div>
          </div>
        </div>
        
        <h2 style="color: #10B981; text-align: center; margin-bottom: 20px;">Test-E-Mail erfolgreich!</h2>
        
        <p style="color: #374151; line-height: 1.6; font-size: 16px; text-align: center;">Ihre E-Mail-Konfiguration funktioniert korrekt.</p>
        
        <div style="background-color: #F0FDF4; border-left: 4px solid #10B981; padding: 20px; margin: 20px 0; border-radius: 0 8px 8px 0;">
          <p style="color: #10B981; margin: 0; font-weight: bold;">✅ SMTP-Verbindung erfolgreich</p>
          <p style="color: #10B981; margin: 10px 0 0 0; font-weight: bold;">✅ E-Mail-Versand funktioniert</p>
        </div>
        
        <hr style="border: none; border-top: 1px solid #E5E7EB; margin: 30px 0;">
        
        <p style="color: #6B7280; font-size: 14px; text-align: center;">
          Gesendet am: ${new Date().toLocaleString('de-DE')}
        </p>
        
        <div style="text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #E5E7EB;">
          <p style="color: #9CA3AF; font-size: 12px; margin: 0;">
            Diese Test-E-Mail wurde von TimeFeed gesendet.<br>
            © ${copyrightYears()} TimeFeed
          </p>
        </div>
      </div>
    `;

    return await this.sendEmail(email, subject, html);
  }

}

export default new EmailService();