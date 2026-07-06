import { Op } from 'sequelize';
import { SystemSettings } from '../models/SystemSettings';
import { EmailSettings } from '../models/EmailSettings';
import { WorkDay } from '../models/WorkDay';
import { User, UserRole } from '../models/User';
import emailService, { renderBrandedEmail, escapeHtml, MAIL_PRIMARY } from './emailService';
import { getPublicBaseUrl } from '../utils/baseUrl';

/**
 * GPS-Warn-Digest (gpsMode='warn'): EINE nächtliche Sammel-Mail pro Firma an
 * die Admins mit allen Stempelungen ohne Standort des Vortags (WorkDay-Flag
 * 'no_gps') — bewusst gebündelt statt einer Mail pro Stempelung.
 * Ohne aktives SMTP passiert nichts; Fehler werden geschluckt.
 */
export async function runGpsWarnDigest(now: Date = new Date()): Promise<void> {
  try {
    const mail = await EmailSettings.findOne();
    if (!mail || !mail.isActive) return;

    const y = new Date(now.getTime() - 24 * 3600 * 1000);
    const yesterday = `${y.getFullYear()}-${String(y.getMonth() + 1).padStart(2, '0')}-${String(y.getDate()).padStart(2, '0')}`;

    const warnSettings = await SystemSettings.findAll({ where: { gpsMode: 'warn', companyId: { [Op.ne]: null } } });
    for (const settings of warnSettings) {
      const companyId = settings.companyId as number;
      const days = await WorkDay.findAll({
        where: { companyId, date: yesterday, flags: { [Op.like]: '%no_gps%' } as any },
      });
      if (days.length === 0) continue;

      const userIds = days.map((d) => d.userId);
      const users = await User.findAll({ where: { id: { [Op.in]: userIds } }, attributes: ['id', 'firstName', 'lastName'] });
      const nameById = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`]));

      const admins = await User.findAll({
        where: { companyId, isActive: true, role: UserRole.ADMIN },
        attributes: ['email'],
      });
      const recipients = admins.map((a) => a.email).filter(Boolean);
      if (recipients.length === 0) continue;

      const rows = days
        .map((d) => `<li>${escapeHtml(nameById.get(d.userId) || `#${d.userId}`)} — ${escapeHtml(d.date)}</li>`)
        .join('');
      const base = await getPublicBaseUrl();
      const html = await renderBrandedEmail({
        title: 'Stempelungen ohne Standort',
        bodyHtml: `
          <p>Am <strong>${escapeHtml(yesterday)}</strong> wurde bei folgenden Mitarbeitenden ohne GPS-Standort gestempelt:</p>
          <ul style="background-color:#FFF7ED;border-left:4px solid ${MAIL_PRIMARY};padding:14px 14px 14px 32px;border-radius:0 8px 8px 0;">${rows}</ul>
          <p>Die betroffenen Tage sind in der Zeitverwaltung markiert (Hinweis „ohne Standort").</p>`,
        button: { text: 'Zeiten verwalten', url: `${base}/manage-times` },
        footerNote: 'Diese Sammel-Meldung kommt nur bei aktiviertem GPS-Modus „Akzeptieren mit Warnung" und nur an Tagen mit Vorkommnissen.',
      });
      try {
        await emailService.sendEmail(recipients, `TimeFeed: ${days.length} Stempelung(en) ohne Standort am ${yesterday}`, html);
        console.log(`GpsDigest: Sammel-Mail für Firma ${companyId} (${days.length} Tage) gesendet.`);
      } catch (e: any) {
        console.error('GpsDigest: Versand fehlgeschlagen:', e?.message);
      }
    }
  } catch (e: any) {
    console.error('GpsDigest fehlgeschlagen:', e?.message);
  }
}
