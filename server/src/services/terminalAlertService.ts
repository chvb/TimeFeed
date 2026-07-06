import { Op } from 'sequelize';
import { TerminalDevice } from '../models/TerminalDevice';
import { SystemSettings } from '../models/SystemSettings';
import { EmailSettings } from '../models/EmailSettings';
import { User, UserRole } from '../models/User';
import emailService, { renderBrandedEmail, escapeHtml, MAIL_PRIMARY } from './emailService';
import { getPublicBaseUrl } from '../utils/baseUrl';

/**
 * Terminal-Überwachung: prüft minütlich alle aktiven Terminals gegen die pro
 * Firma konfigurierte Schwelle (SystemSettings.terminalAlertMinutes) und
 * verschickt gebrandete Störungs-/Entwarnungs-Mails.
 *
 * - Störung: lastSeenAt älter als Schwelle UND noch keine offene Störung
 *   (alertedAt=null) → Mail, alertedAt setzen (genau EINE Mail je Ausfall).
 * - Entwarnung: Terminal meldet sich wieder (lastSeenAt frisch) UND alertedAt
 *   gesetzt → „wieder online"-Mail, alertedAt löschen.
 * - Terminals, die sich noch NIE gemeldet haben (lastSeenAt=null), lösen keine
 *   Störung aus (Neuanlage soll nicht sofort alarmieren).
 * - Empfänger: terminalAlertEmails (Komma-Liste) oder alle aktiven Admins der Firma.
 * - Ohne aktive SMTP-Konfiguration passiert nichts; Versandfehler werden geschluckt.
 */

const CHECK_INTERVAL_MS = 60 * 1000;
let running = false;

async function recipientsForCompany(settings: SystemSettings, companyId: number): Promise<string[]> {
  const configured = (settings.terminalAlertEmails || '').split(',').map((e) => e.trim()).filter(Boolean);
  if (configured.length > 0) return configured;
  const admins = await User.findAll({
    where: { companyId, isActive: true, role: UserRole.ADMIN },
    attributes: ['email'],
  });
  return admins.map((a) => a.email).filter(Boolean);
}

function fmt(d: Date): string {
  return d.toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

async function sendOutageMail(recipients: string[], terminal: TerminalDevice, minutes: number): Promise<void> {
  const base = await getPublicBaseUrl();
  const lastSeen = terminal.lastSeenAt ? fmt(new Date(terminal.lastSeenAt)) : '–';
  const html = await renderBrandedEmail({
    title: 'Terminal-Störung',
    bodyHtml: `
      <p>Das Stempel-Terminal <strong>${escapeHtml(terminal.name)}</strong>${terminal.locationLabel ? ` (${escapeHtml(terminal.locationLabel)})` : ''} hat sich seit über <strong>${minutes} Minuten</strong> nicht mehr gemeldet.</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;background-color:#FFF7ED;border-left:4px solid ${MAIL_PRIMARY};border-radius:0 8px 8px 0;margin:16px 0;">
        <tr><td style="padding:14px 16px;color:#9a3412;font-size:14px;">
          Letzte Meldung: <strong>${escapeHtml(lastSeen)}</strong><br/>
          Mögliche Ursachen: Tablet aus/Akku leer, WLAN-Störung, Browser geschlossen.
        </td></tr>
      </table>
      <p>Stempelungen am Gerät werden lokal zwischengespeichert und nach der Wiederverbindung automatisch nachgereicht.</p>`,
    button: { text: 'Terminals öffnen', url: `${base}/terminals` },
    footerNote: 'Diese Meldung kommt genau einmal pro Ausfall. Sobald sich das Terminal wieder meldet, erhalten Sie eine Entwarnung.',
  });
  await emailService.sendEmail(recipients, `⚠️ TimeFeed: Terminal „${terminal.name}" meldet sich nicht mehr`, html);
}

async function sendRecoveryMail(recipients: string[], terminal: TerminalDevice): Promise<void> {
  const base = await getPublicBaseUrl();
  const html = await renderBrandedEmail({
    title: 'Terminal wieder online',
    bodyHtml: `
      <p>Das Stempel-Terminal <strong>${escapeHtml(terminal.name)}</strong>${terminal.locationLabel ? ` (${escapeHtml(terminal.locationLabel)})` : ''} meldet sich wieder (${escapeHtml(fmt(new Date()))}).</p>
      <p>Zwischengespeicherte Stempelungen werden automatisch nachsynchronisiert.</p>`,
    button: { text: 'Terminals öffnen', url: `${base}/terminals` },
  });
  await emailService.sendEmail(recipients, `✅ TimeFeed: Terminal „${terminal.name}" ist wieder online`, html);
}

export async function checkTerminalAlerts(): Promise<void> {
  if (running) return;
  running = true;
  try {
    // Ohne aktives SMTP keine Prüfungen (Mails könnten ohnehin nicht raus).
    const mail = await EmailSettings.findOne();
    if (!mail || !mail.isActive) return;

    // Alle Firmen-Einstellungen mit aktivierter Überwachung.
    const allSettings = await SystemSettings.findAll({ where: { terminalAlertEnabled: true, companyId: { [Op.ne]: null } } });
    const now = Date.now();

    for (const settings of allSettings) {
      const companyId = settings.companyId as number;
      const thresholdMs = Math.max(2, settings.terminalAlertMinutes || 15) * 60 * 1000;
      const terminals = await TerminalDevice.findAll({ where: { companyId, isActive: true } });
      let recipients: string[] | null = null;

      for (const terminal of terminals) {
        const lastSeen = terminal.lastSeenAt ? new Date(terminal.lastSeenAt).getTime() : null;
        const isDown = lastSeen != null && now - lastSeen > thresholdMs;
        const isUp = lastSeen != null && now - lastSeen <= thresholdMs;

        if (isDown && !terminal.alertedAt) {
          recipients = recipients ?? (await recipientsForCompany(settings, companyId));
          if (recipients.length > 0) {
            try {
              await sendOutageMail(recipients, terminal, settings.terminalAlertMinutes || 15);
              console.log(`TerminalAlert: Störungs-Mail für „${terminal.name}" (Firma ${companyId}) gesendet.`);
            } catch (e: any) {
              console.error('TerminalAlert: Versand fehlgeschlagen:', e?.message);
              continue; // alertedAt NICHT setzen → nächster Lauf versucht es erneut
            }
          }
          await terminal.update({ alertedAt: new Date() });
        } else if (isUp && terminal.alertedAt) {
          recipients = recipients ?? (await recipientsForCompany(settings, companyId));
          if (recipients.length > 0) {
            try { await sendRecoveryMail(recipients, terminal); } catch { /* Entwarnung ist nice-to-have */ }
          }
          await terminal.update({ alertedAt: null });
        }
      }
    }
  } catch (e: any) {
    console.error('TerminalAlert: Prüfung fehlgeschlagen:', e?.message);
  } finally {
    running = false;
  }
}

/** Minütliche Überwachung starten (Aufruf aus index.ts beim Serverstart). */
export function startTerminalAlertService(): void {
  setInterval(() => { void checkTerminalAlerts(); }, CHECK_INTERVAL_MS);
  console.log('TerminalAlert-Überwachung gestartet (Prüfung jede Minute).');
}
