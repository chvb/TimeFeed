import PDFDocument from 'pdfkit';
import { Op } from 'sequelize';
import { User } from '../models/User';
import { WorkDay } from '../models/WorkDay';
import { EmailSettings } from '../models/EmailSettings';
import { SettingsController } from '../controllers/settings.controller';
import emailService, { renderBrandedEmail, MAIL_PRIMARY, escapeHtml } from './emailService';
import { monthEndDate } from './monthLockService';

/**
 * Serverseitiger Monats-Stundenzettel als PDF (pdfkit) + automatischer
 * E-Mail-Versand beim Monatsabschluss.
 *
 * PDF-Layout: Kopf mit TimeFeed-Schriftzug in Orange (#ea580c), Mitarbeitername
 * und Monat; Tabelle aller WorkDays (Datum, Kommen, Gehen, Pause, Ist, Soll,
 * Saldo, Status/Abwesenheit); Summenzeile; Unterschriftszeilen; Fußzeile mit
 * Erstellungsdatum. Standard-Helvetica (WinAnsi) deckt Umlaute ab.
 */

const BRAND_ORANGE = MAIL_PRIMARY; // '#ea580c'
const TEXT_DARK = '#0f172a';
const TEXT_MUTED = '#64748b';
const LINE_GREY = '#e2e8f0';

/** Minuten → 'H:MM' (z. B. 490 → '8:10'). */
export function minutesToHMM(min: number): string {
  const m = Math.round(Math.abs(min || 0));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/** Minuten → vorzeichenbehaftet '+H:MM' / '-H:MM'. */
export function minutesToSignedHMM(min: number): string {
  const v = Math.round(min || 0);
  return `${v < 0 ? '-' : '+'}${minutesToHMM(Math.abs(v))}`;
}

const STATUS_LABELS_DE: Record<string, string> = {
  open: 'Offen',
  incomplete: 'Unvollständig',
  ok: 'OK',
  flagged: 'Auffällig',
  approved: 'Freigegeben',
  locked: 'Abgeschlossen',
};

const ABSENCE_LABELS_DE: Record<string, string> = {
  holiday: 'Feiertag',
  vacation: 'Urlaub',
  sick: 'Krank',
  special_leave: 'Sonderurlaub',
  unpaid_leave: 'Unbezahlt',
  overtime_comp: 'Überstundenausgleich',
  parental_leave: 'Elternzeit',
  training: 'Fortbildung',
  other: 'Sonstiges',
};

function statusText(d: WorkDay): string {
  if (d.absence) {
    return ABSENCE_LABELS_DE[d.absence] || d.absence;
  }
  return STATUS_LABELS_DE[d.status] || d.status;
}

function timeHHMM(value: Date | string | null | undefined): string {
  if (!value) return '–';
  const dt = new Date(value);
  if (isNaN(dt.getTime())) return '–';
  return dt.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

/** Monatslabel 'YYYY-MM' → z. B. 'Juni 2026'. */
export function monthLabelDe(month: string): string {
  return new Date(`${month}-01T00:00:00`).toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

export interface TimesheetPdfInput {
  employeeName: string;
  /** 'YYYY-MM' */
  month: string;
  days: Array<Pick<WorkDay,
    'date' | 'firstIn' | 'lastOut' | 'breakMinutes' | 'autoBreakMinutes'
    | 'workedMinutes' | 'targetMinutes' | 'balanceMinutes' | 'status' | 'absence'>>;
  companyName?: string | null;
}

/** Erzeugt den Monats-Stundenzettel als PDF-Buffer. */
export async function generateTimesheetPdf(input: TimesheetPdfInput): Promise<Buffer> {
  const { employeeName, month } = input;
  const days = [...input.days].sort((a, b) => (a.date < b.date ? -1 : 1));
  const label = monthLabelDe(month);

  const doc = new PDFDocument({ size: 'A4', margins: { top: 48, bottom: 48, left: 48, right: 48 } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const width = right - left;

  // ---- Kopf: TimeFeed-Schriftzug (Orange) + Titel + Mitarbeiter/Monat -------
  doc.font('Helvetica-Bold').fontSize(24).fillColor(BRAND_ORANGE).text('TimeFeed', left, 48);
  doc.font('Helvetica').fontSize(10).fillColor(TEXT_MUTED)
    .text('Monats-Stundenzettel', left, 52, { width, align: 'right' });
  if (input.companyName) {
    doc.text(input.companyName, left, 66, { width, align: 'right' });
  }
  doc.moveTo(left, 84).lineTo(right, 84).lineWidth(1.5).strokeColor(BRAND_ORANGE).stroke();

  doc.font('Helvetica-Bold').fontSize(14).fillColor(TEXT_DARK).text(employeeName, left, 96);
  doc.font('Helvetica').fontSize(11).fillColor(TEXT_MUTED).text(label, left, 114);

  // ---- Tabelle ---------------------------------------------------------------
  // Spalten: Datum | Kommen | Gehen | Pause | Ist | Soll | Saldo | Status/Abwesenheit
  const cols = [
    { key: 'date', label: 'Datum', w: 0.16, align: 'left' as const },
    { key: 'in', label: 'Kommen', w: 0.10, align: 'right' as const },
    { key: 'out', label: 'Gehen', w: 0.10, align: 'right' as const },
    { key: 'break', label: 'Pause', w: 0.09, align: 'right' as const },
    { key: 'worked', label: 'Ist', w: 0.10, align: 'right' as const },
    { key: 'target', label: 'Soll', w: 0.10, align: 'right' as const },
    { key: 'balance', label: 'Saldo', w: 0.11, align: 'right' as const },
    { key: 'status', label: 'Status', w: 0.24, align: 'left' as const },
  ];
  const colX: number[] = [];
  let acc = left;
  for (const c of cols) { colX.push(acc); acc += c.w * width; }

  const ROW_H = 16;
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 40;
  let y = 140;

  const drawHeaderRow = () => {
    doc.rect(left, y - 3, width, ROW_H).fillColor('#fff7ed').fill();
    doc.font('Helvetica-Bold').fontSize(8).fillColor(BRAND_ORANGE);
    cols.forEach((c, i) => {
      doc.text(c.label.toUpperCase(), colX[i] + 2, y, { width: c.w * width - 6, align: c.align });
    });
    y += ROW_H;
    doc.moveTo(left, y - 4).lineTo(right, y - 4).lineWidth(0.5).strokeColor(BRAND_ORANGE).stroke();
  };

  const ensureSpace = (needed: number) => {
    if (y + needed > bottomLimit) {
      doc.addPage();
      y = doc.page.margins.top;
      drawHeaderRow();
    }
  };

  drawHeaderRow();

  const sums = { breaks: 0, worked: 0, target: 0, balance: 0 };
  doc.font('Helvetica').fontSize(9);
  for (const d of days) {
    ensureSpace(ROW_H);
    const pause = (d.breakMinutes || 0) + (d.autoBreakMinutes || 0);
    sums.breaks += pause;
    sums.worked += d.workedMinutes || 0;
    sums.target += d.targetMinutes || 0;
    sums.balance += d.balanceMinutes || 0;
    const dateLabel = new Date(`${d.date}T00:00:00`).toLocaleDateString('de-DE', {
      weekday: 'short', day: '2-digit', month: '2-digit',
    });
    const cells = [
      dateLabel,
      timeHHMM(d.firstIn),
      timeHHMM(d.lastOut),
      pause > 0 ? minutesToHMM(pause) : '–',
      minutesToHMM(d.workedMinutes || 0),
      minutesToHMM(d.targetMinutes || 0),
      minutesToSignedHMM(d.balanceMinutes || 0),
      statusText(d as WorkDay),
    ];
    doc.font('Helvetica').fontSize(9);
    cells.forEach((val, i) => {
      const isBalance = cols[i].key === 'balance';
      doc.fillColor(isBalance ? ((d.balanceMinutes || 0) < 0 ? '#dc2626' : '#16a34a') : TEXT_DARK);
      doc.text(val, colX[i] + 2, y, { width: cols[i].w * width - 6, align: cols[i].align, lineBreak: false });
    });
    y += ROW_H;
    doc.moveTo(left, y - 4).lineTo(right, y - 4).lineWidth(0.25).strokeColor(LINE_GREY).stroke();
  }

  // ---- Summenzeile -------------------------------------------------------------
  ensureSpace(ROW_H + 6);
  doc.rect(left, y - 3, width, ROW_H + 2).fillColor('#f8fafc').fill();
  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_DARK);
  doc.text('Summen', colX[0] + 2, y, { width: cols[0].w * width - 6 });
  const sumCells: Array<[number, string]> = [
    [3, minutesToHMM(sums.breaks)],
    [4, minutesToHMM(sums.worked)],
    [5, minutesToHMM(sums.target)],
  ];
  for (const [i, val] of sumCells) {
    doc.text(val, colX[i] + 2, y, { width: cols[i].w * width - 6, align: 'right', lineBreak: false });
  }
  doc.fillColor(sums.balance < 0 ? '#dc2626' : '#16a34a')
    .text(minutesToSignedHMM(sums.balance), colX[6] + 2, y, { width: cols[6].w * width - 6, align: 'right', lineBreak: false });
  y += ROW_H + 6;
  doc.moveTo(left, y - 4).lineTo(right, y - 4).lineWidth(1).strokeColor(BRAND_ORANGE).stroke();

  // ---- Unterschriften -----------------------------------------------------------
  if (y + 90 > bottomLimit) { doc.addPage(); y = doc.page.margins.top; }
  y += 56;
  const sigW = width * 0.4;
  doc.lineWidth(0.75).strokeColor(TEXT_MUTED);
  doc.moveTo(left, y).lineTo(left + sigW, y).stroke();
  doc.moveTo(right - sigW, y).lineTo(right, y).stroke();
  doc.font('Helvetica').fontSize(9).fillColor(TEXT_MUTED);
  doc.text('Mitarbeiter', left, y + 4, { width: sigW });
  doc.text('Arbeitgeber', right - sigW, y + 4, { width: sigW });

  // ---- Fußzeile -------------------------------------------------------------------
  const createdAt = new Date().toLocaleString('de-DE', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
  doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED).text(
    `Erstellt mit TimeFeed am ${createdAt}`,
    left,
    doc.page.height - doc.page.margins.bottom - 12,
    { width, align: 'center', lineBreak: false }
  );

  doc.end();
  return done;
}

// ---------------------------------------------------------------------------
// Automatischer Versand beim Monatsabschluss
// ---------------------------------------------------------------------------

const settingsController = new SettingsController();

/** Effektive Einstellung: User-Override vor Firmen-Default. */
function timesheetEmailEnabled(user: User, companyDefault: boolean): boolean {
  const mode = user.timesheetEmailMode || 'inherit';
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return companyDefault;
}

/**
 * Versendet nach erfolgreichem Monatsabschluss die Stundenzettel-PDFs an alle
 * betroffenen Mitarbeiter mit aktiver effektiver Einstellung und E-Mail-Adresse.
 *
 * Fire-and-forget: Fehler werden geloggt, aber NIE geworfen (der Abschluss
 * selbst ist bereits erfolgreich). Ohne aktives SMTP wird still übersprungen.
 */
export async function sendTimesheetsForClosedMonth(
  users: User[],
  companyId: number | null,
  month: string
): Promise<void> {
  try {
    // Nur wenn SMTP aktiv ist — sonst still überspringen.
    const emailSettings = await EmailSettings.findOne();
    if (!emailSettings || !emailSettings.isActive) {
      console.log(`Stundenzettel-Versand (${month}): SMTP inaktiv — übersprungen.`);
      return;
    }

    const settings = await settingsController.getOrCreateSettings(companyId);
    const companyDefault = !!settings.sendTimesheetOnClose;

    const recipients = users.filter((u) => u.email && timesheetEmailEnabled(u, companyDefault));
    if (recipients.length === 0) return;

    const label = monthLabelDe(month);
    const dateRange = { [Op.gte]: `${month}-01`, [Op.lte]: monthEndDate(month) };

    for (const user of recipients) {
      try {
        const days = await WorkDay.findAll({
          where: { userId: user.id, date: dateRange },
          order: [['date', 'ASC']],
        });
        const worked = days.reduce((s, d) => s + (d.workedMinutes || 0), 0);
        const target = days.reduce((s, d) => s + (d.targetMinutes || 0), 0);
        const balance = days.reduce((s, d) => s + (d.balanceMinutes || 0), 0);

        const pdf = await generateTimesheetPdf({
          employeeName: `${user.firstName} ${user.lastName}`,
          month,
          days,
          companyName: settings.companyName,
        });

        const html = await renderBrandedEmail({
          title: `Ihr Stundenzettel für ${label}`,
          bodyHtml: `
            <p>Hallo ${escapeHtml(user.firstName)},</p>
            <p>der Monat <strong>${escapeHtml(label)}</strong> wurde abgeschlossen. Ihren Stundenzettel finden Sie im Anhang dieser E-Mail.</p>
            <table role="presentation" cellpadding="0" cellspacing="0" style="margin:16px auto;background-color:#FFF7ED;border-left:4px solid ${MAIL_PRIMARY};border-radius:0 8px 8px 0;">
              <tr><td style="padding:14px 18px;color:#9a3412;font-size:15px;">
                Ist: <strong>${minutesToHMM(worked)} h</strong> &nbsp;·&nbsp;
                Soll: <strong>${minutesToHMM(target)} h</strong> &nbsp;·&nbsp;
                Saldo: <strong>${minutesToSignedHMM(balance)} h</strong>
              </td></tr>
            </table>`,
          footerNote: 'Diese E-Mail wurde automatisch beim Monatsabschluss erstellt.',
        });

        await emailService.sendEmail(
          user.email,
          `Ihr Stundenzettel für ${label}`,
          html,
          undefined,
          [{ filename: `Stundenzettel-${month}.pdf`, content: pdf, contentType: 'application/pdf' }]
        );
        console.log(`Stundenzettel ${month} an ${user.email} gesendet.`);
      } catch (e) {
        // Einzelfehler schlucken — die übrigen Empfänger sollen ihre Mail trotzdem bekommen.
        console.error(`Stundenzettel-Versand an ${user.email} fehlgeschlagen:`, (e as any)?.message || e);
      }
    }
  } catch (e) {
    console.error('Stundenzettel-Versand nach Monatsabschluss fehlgeschlagen:', (e as any)?.message || e);
  }
}
