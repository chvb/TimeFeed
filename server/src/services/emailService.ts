import * as nodemailer from 'nodemailer';
import { EmailSettings } from '../models/EmailSettings';
import { copyrightYears } from '../utils/copyright';
import { getPublicBaseUrl } from '../utils/baseUrl';

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

// ---------------------------------------------------------------------------
// Einheitliches Marken-Layout für ALLE ausgehenden Mails (Feed-Familie):
// Orange-Kopf mit Logo, gebrandeter Button, einheitlicher Footer.
// Logo als absolute URL über publicUrl — SVG/Data-URLs blocken viele Clients.
// Tabellen-Layout + bgcolor-Fallback für Outlook (kein Gradient-Support).
// ---------------------------------------------------------------------------
export const MAIL_PRIMARY = '#ea580c';
const MAIL_GRADIENT = 'linear-gradient(135deg, #fb923c 0%, #ea580c 100%)';

export interface BrandedEmailOptions {
  /** Überschrift im Inhaltsbereich. */
  title: string;
  /** Fertiges (bereits escaptes) HTML für den Inhalt. */
  bodyHtml: string;
  /** Optionaler Call-to-Action-Button. */
  button?: { text: string; url: string };
  /** Kleingedruckter Hinweis über dem Footer. */
  footerNote?: string;
}

export async function renderBrandedEmail(opts: BrandedEmailOptions): Promise<string> {
  const base = await getPublicBaseUrl();
  const button = opts.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:28px auto;">
        <tr><td align="center" bgcolor="${MAIL_PRIMARY}" style="border-radius:10px;">
          <a href="${opts.button.url}" style="display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-weight:bold;font-size:16px;font-family:Arial,Helvetica,sans-serif;">${escapeHtml(opts.button.text)}</a>
        </td></tr>
      </table>`
    : '';
  const note = opts.footerNote
    ? `<p style="color:#6B7280;font-size:13px;text-align:center;margin:24px 0 0;">${escapeHtml(opts.footerNote)}</p>`
    : '';
  return `<!doctype html>
  <html><body style="margin:0;padding:0;background-color:#f1f5f9;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f1f5f9;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
        <tr>
          <td align="center" bgcolor="${MAIL_PRIMARY}" style="background:${MAIL_GRADIENT};padding:28px 20px;border-radius:14px 14px 0 0;">
            <img src="${base}/icons/icon-192.png" width="52" height="52" alt="TimeFeed" style="display:inline-block;vertical-align:middle;border-radius:12px;border:0;" />
            <span style="display:inline-block;vertical-align:middle;margin-left:14px;color:#ffffff;font-size:28px;font-weight:bold;font-family:Arial,Helvetica,sans-serif;letter-spacing:-0.5px;">TimeFeed</span>
          </td>
        </tr>
        <tr>
          <td bgcolor="#ffffff" style="background-color:#ffffff;padding:32px 28px;border-radius:0 0 14px 14px;font-family:Arial,Helvetica,sans-serif;">
            <h2 style="color:${MAIL_PRIMARY};text-align:center;margin:0 0 20px;font-size:22px;">${escapeHtml(opts.title)}</h2>
            <div style="color:#374151;line-height:1.6;font-size:16px;">${opts.bodyHtml}</div>
            ${button}
            ${note}
            <hr style="border:none;border-top:1px solid #E5E7EB;margin:28px 0 16px;" />
            <p style="color:#9CA3AF;font-size:12px;text-align:center;margin:0;">
              Diese E-Mail wurde von TimeFeed gesendet · <a href="${base}" style="color:#9CA3AF;">${base.replace(/^https?:\/\//, '')}</a><br />
              © ${copyrightYears()} TimeFeed
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
  </body></html>`;
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
    const base = await getPublicBaseUrl();
    const resetUrl = `${base}/reset-password?token=${resetToken}`;

    const subject = 'Passwort zurücksetzen - TimeFeed';
    const html = await renderBrandedEmail({
      title: 'Passwort zurücksetzen',
      bodyHtml: `
        <p>Sie haben eine Passwort-Zurücksetzung für Ihr TimeFeed-Konto angefordert.</p>
        <p>Klicken Sie auf den Button, um ein neues Passwort zu vergeben — oder kopieren Sie diesen Link in Ihren Browser:</p>
        <p style="background-color:#FFF7ED;padding:14px;border-radius:8px;word-break:break-all;font-family:monospace;font-size:12px;border-left:4px solid ${MAIL_PRIMARY};">${resetUrl}</p>`,
      button: { text: 'Passwort zurücksetzen', url: resetUrl },
      footerNote: 'Dieser Link ist 1 Stunde gültig. Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.',
    });
    return await this.sendEmail(email, subject, html);
  }

  // Willkommens-Mail für per UrlaubsFeed-Abgleich (o. ä.) angelegte Konten:
  // gebrandete Mail mit „Passwort festlegen"-Link (PasswordResetToken-Flow).
  async sendWelcome(email: string, firstName: string, resetToken: string): Promise<any> {
    const base = await getPublicBaseUrl();
    const resetUrl = `${base}/reset-password?token=${resetToken}`;

    const subject = 'Willkommen bei TimeFeed';
    const html = await renderBrandedEmail({
      title: 'Willkommen bei TimeFeed',
      bodyHtml: `
        <p>Hallo ${escapeHtml(firstName)},</p>
        <p>für Sie wurde ein TimeFeed-Konto angelegt. Legen Sie jetzt Ihr persönliches Passwort fest, um mit der Zeiterfassung zu starten.</p>
        <p>Klicken Sie auf den Button — oder kopieren Sie diesen Link in Ihren Browser:</p>
        <p style="background-color:#FFF7ED;padding:14px;border-radius:8px;word-break:break-all;font-family:monospace;font-size:12px;border-left:4px solid ${MAIL_PRIMARY};">${resetUrl}</p>`,
      button: { text: 'Passwort festlegen', url: resetUrl },
      footerNote: 'Dieser Link ist 7 Tage gültig. Falls Sie dieses Konto nicht erwarten, wenden Sie sich bitte an Ihre Administration.',
    });
    return await this.sendEmail(email, subject, html);
  }

  async sendTestEmail(email: string): Promise<any> {
    const subject = 'TimeFeed Test-E-Mail';
    const html = await renderBrandedEmail({
      title: 'Test-E-Mail erfolgreich!',
      bodyHtml: `
        <p style="text-align:center;">Ihre E-Mail-Konfiguration funktioniert korrekt.</p>
        <div style="background-color:#FFF7ED;border-left:4px solid ${MAIL_PRIMARY};padding:18px;margin:20px 0;border-radius:0 8px 8px 0;">
          <p style="color:#9a3412;margin:0;font-weight:bold;">&#10004; SMTP-Verbindung erfolgreich</p>
          <p style="color:#9a3412;margin:10px 0 0;font-weight:bold;">&#10004; E-Mail-Versand funktioniert</p>
        </div>`,
      footerNote: `Gesendet am: ${new Date().toLocaleString('de-DE')}`,
    });
    return await this.sendEmail(email, subject, html);
  }

}

export default new EmailService();