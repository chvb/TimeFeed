import { Op } from 'sequelize';
import ExcelJS from 'exceljs';
import { SystemSettings } from '../models/SystemSettings';
import { EmailSettings } from '../models/EmailSettings';
import { User, UserRole } from '../models/User';
import { WorkDay } from '../models/WorkDay';
import { AbsenceType } from '../models/AbsenceType';
import { SettingsController } from '../controllers/settings.controller';
import emailService, { renderBrandedEmail, escapeHtml, MAIL_PRIMARY } from './emailService';
import { computeNextRun } from './autoBackupService';

/**
 * Periodische Berichts-Mails (Tag / Monat / Quartal / Jahr, pro Firma
 * konfigurierbar über SystemSettings.report*Enabled + reportRecipients):
 *
 * - buildPeriodReport aggregiert die WorkDays eines Zeitraums je User
 *   (Soll/Ist/Saldo, Abwesenheiten je Art, unvollständige/auffällige Tage)
 *   plus Firmensummen.
 * - sendPeriodReport verschickt den Bericht der jeweils ABGELAUFENEN Periode
 *   (day = Vortag, month = Vormonat, quarter = letztes Quartal, year =
 *   Vorjahr) als gebrandete HTML-Mail; bei month/quarter/year zusätzlich mit
 *   XLSX-Anhang (Sheet „Übersicht" + Sheet „Tage" — exceljs, exportService-Stil).
 * - Scheduler: täglicher Tick um 05:00 (nach Recalc 02:00 und Backup ~02:30)
 *   über setTimeout-Rescheduling (Muster autoBackupService). Doppelversand-
 *   Schutz über reportLastSent (JSON in SystemSettings, Spalte via
 *   secondarySchemaEnsure): {day:'YYYY-MM-DD', month:'YYYY-MM',
 *   quarter:'YYYY-Qn', year:'YYYY'}.
 * - Nur bei aktivem SMTP; Fehler werden geloggt und geschluckt.
 */

const settingsController = new SettingsController();

export type ReportPeriod = 'day' | 'month' | 'quarter' | 'year';
export const REPORT_PERIODS: ReportPeriod[] = ['day', 'month', 'quarter', 'year'];

/** Tick-Uhrzeit des Schedulers (nach Recalc 02:00 und Auto-Backup ~02:30). */
export const REPORT_TICK_TIME = '05:00';

// ---------------------------------------------------------------------------
// Pure Perioden-Helfer (lokale Serverzeit; via Jest mit festen Dates getestet)
// ---------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, '0');
const ymdLocal = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const ddmmyyyy = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;

const MONTH_NAMES_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

export interface PeriodRange {
  period: ReportPeriod;
  /** Erster Tag des Zeitraums (YYYY-MM-DD, inklusiv). */
  from: string;
  /** Letzter Tag des Zeitraums (YYYY-MM-DD, inklusiv). */
  to: string;
  /** Schlüssel für den Doppelversand-Schutz (reportLastSent). */
  key: string;
  /** Mail-Titel, z. B. „Monatsbericht Juni 2026". */
  title: string;
}

/**
 * Zeitraum der jeweils zuletzt ABGELAUFENEN Periode relativ zu refDate:
 * day = Vortag; month = Vormonat; quarter = letztes volles Quartal;
 * year = Vorjahr. Rechnet ausschließlich mit lokalen Date-Komponenten
 * (schaltjahr-/DST-sicher, keine UTC-Verschiebung).
 */
export function previousPeriodRange(period: ReportPeriod, refDate: Date): PeriodRange {
  const y = refDate.getFullYear();
  const m = refDate.getMonth(); // 0-basiert

  switch (period) {
    case 'day': {
      const d = new Date(y, m, refDate.getDate() - 1);
      const iso = ymdLocal(d);
      return { period, from: iso, to: iso, key: iso, title: `Tagesbericht ${ddmmyyyy(iso)}` };
    }
    case 'month': {
      const first = new Date(y, m - 1, 1);
      const last = new Date(y, m, 0); // Tag 0 = letzter Tag des Vormonats
      const key = `${first.getFullYear()}-${pad2(first.getMonth() + 1)}`;
      return {
        period, from: ymdLocal(first), to: ymdLocal(last), key,
        title: `Monatsbericht ${MONTH_NAMES_DE[first.getMonth()]} ${first.getFullYear()}`,
      };
    }
    case 'quarter': {
      const currentQuarterStartMonth = Math.floor(m / 3) * 3;
      const first = new Date(y, currentQuarterStartMonth - 3, 1);
      const last = new Date(first.getFullYear(), first.getMonth() + 3, 0);
      const qn = Math.floor(first.getMonth() / 3) + 1;
      const key = `${first.getFullYear()}-Q${qn}`;
      return {
        period, from: ymdLocal(first), to: ymdLocal(last), key,
        title: `Quartalsbericht Q${qn} ${first.getFullYear()}`,
      };
    }
    case 'year':
    default: {
      const year = y - 1;
      return {
        period: 'year', from: `${year}-01-01`, to: `${year}-12-31`,
        key: String(year), title: `Jahresbericht ${year}`,
      };
    }
  }
}

/**
 * Welche Perioden sind an diesem Kalendertag grundsätzlich fällig?
 * day: täglich; month: am 1.; quarter: am 1.1./1.4./1.7./1.10.; year: am 1.1.
 * (Aktivierungs-Schalter je Firma filtert der Aufrufer.)
 */
export function duePeriodsOn(date: Date): ReportPeriod[] {
  const due: ReportPeriod[] = ['day'];
  if (date.getDate() === 1) {
    due.push('month');
    if (date.getMonth() % 3 === 0) due.push('quarter');
    if (date.getMonth() === 0) due.push('year');
  }
  return due;
}

/** reportLastSent defensiv parsen (fehlend/kaputt = noch nichts versendet). */
export function parseLastSent(raw: string | null | undefined): Partial<Record<ReportPeriod, string>> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* kaputtes JSON = kein Schutz-Eintrag */ }
  return {};
}

/** Doppelversand-Gate: true = Periode mit diesem Key noch nicht verschickt. */
export function shouldSendPeriod(rawLastSent: string | null | undefined, period: ReportPeriod, key: string): boolean {
  return parseLastSent(rawLastSent)[period] !== key;
}

/** Komma-Liste aus reportRecipients defensiv in E-Mail-Array zerlegen. */
export function parseRecipients(raw: string | null | undefined): string[] {
  return String(raw || '').split(',').map((e) => e.trim()).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Aggregation (pure — testbar ohne DB)
// ---------------------------------------------------------------------------

export interface ReportUserRow {
  userId: number;
  name: string;
  personalNr: string;
  sollMin: number;
  istMin: number;
  saldoMin: number;
  /** Abwesenheitstage je Art (key → Anzahl Tage). */
  absenceDays: Record<string, number>;
  incompleteDays: number;
  /** Auffällige Tage: status 'flagged' oder Warn-Flags (ArbZG, Auto-Kappung …). */
  flaggedDays: number;
}

export interface ReportTotals {
  sollMin: number;
  istMin: number;
  saldoMin: number;
  absenceDays: number;
  incompleteDays: number;
  flaggedDays: number;
}

export interface ReportDayRow {
  userId: number;
  date: string;
  name: string;
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  targetMinutes: number;
  balanceMinutes: number;
  status: string;
  absence: string | null;
  flags: string[];
}

export interface PeriodReport {
  companyId: number;
  from: string;
  to: string;
  rows: ReportUserRow[];
  totals: ReportTotals;
  days: ReportDayRow[];
  /** Anzeige-Labels je Abwesenheits-Key (AbsenceType-Katalog, Fallback Key). */
  absenceLabels: Record<string, string>;
}

interface UserLite { id: number; firstName: string; lastName: string; employeeNumber?: string | null }
interface WorkDayLite {
  userId: number; date: string; targetMinutes: number; workedMinutes: number;
  balanceMinutes: number; status: string; flags?: string[] | null; absence?: string | null;
}

/** Flags defensiv als Array lesen (JSON-Spalte kann als String ankommen). */
const flagsOf = (d: WorkDayLite): string[] => {
  const raw: any = d.flags;
  if (Array.isArray(raw)) return raw;
  if (typeof raw === 'string') {
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
};

// 'target_credited' ist reine Buchhaltung (Sollzeit-Gutschrift) — keine Auffälligkeit.
const WARN_FLAG = (f: string) => f !== 'target_credited';

/**
 * WorkDays eines Zeitraums je User zu Berichtszeilen + Firmensummen
 * aggregieren. Nur User mit mindestens einem WorkDay im Zeitraum erscheinen.
 */
export function aggregateReportRows(users: UserLite[], workDays: WorkDayLite[]): { rows: ReportUserRow[]; totals: ReportTotals } {
  const rows: ReportUserRow[] = [];
  const totals: ReportTotals = { sollMin: 0, istMin: 0, saldoMin: 0, absenceDays: 0, incompleteDays: 0, flaggedDays: 0 };

  for (const u of users) {
    const wds = workDays.filter((d) => d.userId === u.id);
    if (wds.length === 0) continue;
    const row: ReportUserRow = {
      userId: u.id,
      name: `${u.firstName} ${u.lastName}`,
      personalNr: String(u.employeeNumber || '').trim(),
      sollMin: 0, istMin: 0, saldoMin: 0,
      absenceDays: {}, incompleteDays: 0, flaggedDays: 0,
    };
    for (const d of wds) {
      row.sollMin += d.targetMinutes;
      row.istMin += d.workedMinutes;
      row.saldoMin += d.balanceMinutes;
      if (d.absence) row.absenceDays[d.absence] = (row.absenceDays[d.absence] || 0) + 1;
      if (d.status === 'incomplete') row.incompleteDays += 1;
      if (d.status === 'flagged' || flagsOf(d).some(WARN_FLAG)) row.flaggedDays += 1;
    }
    rows.push(row);
    totals.sollMin += row.sollMin;
    totals.istMin += row.istMin;
    totals.saldoMin += row.saldoMin;
    totals.absenceDays += Object.values(row.absenceDays).reduce((s, n) => s + n, 0);
    totals.incompleteDays += row.incompleteDays;
    totals.flaggedDays += row.flaggedDays;
  }
  return { rows, totals };
}

// ---------------------------------------------------------------------------
// Datensammlung
// ---------------------------------------------------------------------------

/** WorkDays des Zeitraums je User der Firma aggregieren (+ Firmensummen). */
export async function buildPeriodReport(companyId: number, from: string, to: string): Promise<PeriodReport> {
  const users = await User.findAll({
    where: { companyId, isActive: true },
    attributes: ['id', 'firstName', 'lastName', 'employeeNumber'],
    order: [['lastName', 'ASC'], ['firstName', 'ASC']],
  });
  const userIds = users.map((u) => u.id);

  const workDays = userIds.length === 0 ? [] : await WorkDay.findAll({
    where: { userId: { [Op.in]: userIds }, date: { [Op.gte]: from, [Op.lte]: to } },
    order: [['date', 'ASC']],
  });

  const { rows, totals } = aggregateReportRows(users as any, workDays as any);

  // Anzeige-Labels der Abwesenheitsarten (globale Vorlagen + Firma; Firma gewinnt).
  const absenceLabels: Record<string, string> = {};
  const types = await AbsenceType.findAll({ where: { [Op.or]: [{ companyId: null }, { companyId }] } });
  for (const t of types as any[]) {
    if (absenceLabels[t.key] === undefined || t.companyId != null) absenceLabels[t.key] = t.label || t.key;
  }

  const nameById = new Map(rows.map((r) => [r.userId, r.name]));
  const days: ReportDayRow[] = (workDays as WorkDay[])
    .filter((d) => nameById.has(d.userId))
    .map((d) => ({
      userId: d.userId,
      date: d.date,
      name: nameById.get(d.userId) || '',
      firstIn: d.firstIn ?? null,
      lastOut: d.lastOut ?? null,
      workedMinutes: d.workedMinutes,
      targetMinutes: d.targetMinutes,
      balanceMinutes: d.balanceMinutes,
      status: d.status,
      absence: d.absence ?? null,
      flags: flagsOf(d as any),
    }));

  return { companyId, from, to, rows, totals, days, absenceLabels };
}

// ---------------------------------------------------------------------------
// Darstellung (HTML-Tabelle + XLSX-Anhang)
// ---------------------------------------------------------------------------

/** Minuten → 'H:MM' (Saldo mit Vorzeichen via fmtSigned). */
export function fmtHM(minutes: number): string {
  const abs = Math.abs(Math.round(minutes));
  return `${Math.floor(abs / 60)}:${pad2(abs % 60)}`;
}
const fmtSigned = (minutes: number): string => `${minutes < 0 ? '-' : '+'}${fmtHM(minutes)}`;

const fmtTime = (d: Date | null | undefined): string => {
  if (!d) return '';
  const x = new Date(d);
  return `${pad2(x.getHours())}:${pad2(x.getMinutes())}`;
};

const absenceSummary = (row: ReportUserRow, labels: Record<string, string>): string =>
  Object.entries(row.absenceDays)
    .map(([key, n]) => `${labels[key] || key} ${n}`)
    .join(', ');

const issueSummary = (row: ReportUserRow): string => {
  const parts: string[] = [];
  if (row.incompleteDays > 0) parts.push(`${row.incompleteDays} unvollständig`);
  if (row.flaggedDays > 0) parts.push(`${row.flaggedDays} markiert`);
  return parts.join(', ');
};

/** HTML-Tabelle des Berichts (Name, Soll, Ist, Saldo farbig, Abwesenheiten, Auffälligkeiten) + Summenzeile. */
export function buildReportTableHtml(report: PeriodReport): string {
  const th = 'padding:8px 10px;font-size:13px;color:#374151;text-align:left;border-bottom:2px solid #E5E7EB;white-space:nowrap;';
  const thNum = th.replace('text-align:left', 'text-align:right');
  const td = 'padding:7px 10px;font-size:13px;color:#374151;border-bottom:1px solid #F3F4F6;';
  const tdNum = `${td}text-align:right;white-space:nowrap;`;
  const saldoColor = (m: number) => (m < 0 ? '#DC2626' : '#16A34A');

  const bodyRows = report.rows.map((r) => `
        <tr>
          <td style="${td}">${escapeHtml(r.name)}</td>
          <td style="${tdNum}">${fmtHM(r.sollMin)}</td>
          <td style="${tdNum}">${fmtHM(r.istMin)}</td>
          <td style="${tdNum}color:${saldoColor(r.saldoMin)};font-weight:bold;">${fmtSigned(r.saldoMin)}</td>
          <td style="${td}">${escapeHtml(absenceSummary(r, report.absenceLabels) || '–')}</td>
          <td style="${td}">${escapeHtml(issueSummary(r) || '–')}</td>
        </tr>`).join('');

  const t = report.totals;
  const tdSum = 'padding:9px 10px;font-size:13px;color:#111827;font-weight:bold;border-top:2px solid #E5E7EB;';
  const tdSumNum = `${tdSum}text-align:right;white-space:nowrap;`;
  const sumRow = `
        <tr>
          <td style="${tdSum}">Summe (${report.rows.length} Mitarbeiter)</td>
          <td style="${tdSumNum}">${fmtHM(t.sollMin)}</td>
          <td style="${tdSumNum}">${fmtHM(t.istMin)}</td>
          <td style="${tdSumNum}color:${saldoColor(t.saldoMin)};">${fmtSigned(t.saldoMin)}</td>
          <td style="${tdSum}">${t.absenceDays} Tage</td>
          <td style="${tdSum}">${t.incompleteDays + t.flaggedDays > 0 ? `${t.incompleteDays} / ${t.flaggedDays}` : '–'}</td>
        </tr>`;

  return `
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:16px 0;">
        <tr>
          <th style="${th}">Name</th>
          <th style="${thNum}">Soll</th>
          <th style="${thNum}">Ist</th>
          <th style="${thNum}">Saldo</th>
          <th style="${th}">Abwesenheiten</th>
          <th style="${th}">Auffälligkeiten</th>
        </tr>${bodyRows}${sumRow}
      </table>`;
}

/**
 * XLSX-Anhang (exceljs, exportService-Stil): Sheet „Übersicht" (eine Zeile je
 * Mitarbeiter + Summenzeile) und Sheet „Tage" mit allen WorkDays des Zeitraums.
 */
export async function buildReportXlsx(report: PeriodReport, title: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'TimeFeed';
  workbook.created = new Date();
  const toH = (m: number) => Math.round((m / 60) * 100) / 100;
  // Formel-Injection in Tabellenzellen neutralisieren: führende =,+,-,@,TAB,CR mit ' entschärfen
  // (falls die XLSX später als CSV re-importiert wird). Betrifft nur nutzergesteuerte Textfelder.
  const cellSafe = (v: any): string => {
    const s = String(v ?? '');
    return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  };

  const sheet = workbook.addWorksheet('Übersicht');
  sheet.addRow([`${title} (${ddmmyyyy(report.from)} – ${ddmmyyyy(report.to)})`]);
  sheet.getRow(1).font = { bold: true, size: 14 };
  sheet.addRow([]);
  const header = sheet.addRow(['PersonalNr', 'Name', 'Soll (h)', 'Ist (h)', 'Saldo (h)',
    'Abwesenheitstage', 'Abwesenheiten', 'Unvollständige Tage', 'Auffällige Tage']);
  header.font = { bold: true };
  for (const r of report.rows) {
    sheet.addRow([cellSafe(r.personalNr), cellSafe(r.name), toH(r.sollMin), toH(r.istMin), toH(r.saldoMin),
      Object.values(r.absenceDays).reduce((s, n) => s + n, 0),
      absenceSummary(r, report.absenceLabels),
      r.incompleteDays, r.flaggedDays]);
  }
  const t = report.totals;
  const sum = sheet.addRow(['', 'Summe', toH(t.sollMin), toH(t.istMin), toH(t.saldoMin),
    t.absenceDays, '', t.incompleteDays, t.flaggedDays]);
  sum.font = { bold: true };
  sheet.columns.forEach((c) => { c.width = 16; });
  sheet.getColumn(2).width = 26;
  sheet.getColumn(7).width = 26;

  const daySheet = workbook.addWorksheet('Tage');
  const dayHeader = daySheet.addRow(['Datum', 'Mitarbeiter', 'Kommen', 'Gehen', 'Ist (h)', 'Soll (h)', 'Saldo (h)', 'Status', 'Abwesenheit', 'Flags']);
  dayHeader.font = { bold: true };
  for (const d of report.days) {
    daySheet.addRow([d.date, cellSafe(d.name), fmtTime(d.firstIn), fmtTime(d.lastOut),
      toH(d.workedMinutes), toH(d.targetMinutes), toH(d.balanceMinutes), d.status,
      d.absence ? (report.absenceLabels[d.absence] || d.absence) : '',
      (d.flags || []).join(', ')]);
  }
  daySheet.columns.forEach((c) => { c.width = 14; });
  daySheet.getColumn(2).width = 26;
  daySheet.getColumn(10).width = 30;

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

// ---------------------------------------------------------------------------
// Versand
// ---------------------------------------------------------------------------

export interface SendReportResult {
  sent: boolean;
  reason?: 'SMTP_INACTIVE' | 'NO_RECIPIENTS' | 'SEND_FAILED';
  recipients?: number;
  period: ReportPeriod;
  from?: string;
  to?: string;
  title?: string;
}

/** Empfänger: reportRecipients (Komma-Liste) oder alle aktiven Admins der Firma. */
async function resolveRecipients(settings: SystemSettings, companyId: number): Promise<string[]> {
  const configured = parseRecipients(settings.reportRecipients);
  if (configured.length > 0) return configured;
  // Fallback auf die GLOBALE Vorlage: Super-Admins ohne Firmen-Kontext pflegen
  // ihre Empfänger dort — die Firmen-Zeile wurde ggf. vorher geklont und ist leer.
  const globalSettings = await SystemSettings.findOne({ where: { companyId: null } });
  const globalConfigured = parseRecipients(globalSettings?.reportRecipients ?? null);
  if (globalConfigured.length > 0) return globalConfigured;
  const admins = await User.findAll({
    where: { companyId, isActive: true, role: UserRole.ADMIN },
    attributes: ['email'],
  });
  return admins.map((a) => a.email).filter(Boolean);
}

/**
 * Bericht der jeweils zuletzt abgelaufenen Periode an die konfigurierten
 * Empfänger senden. updateLastSent=true setzt nach ERFOLGREICHEM Versand den
 * Doppelversand-Merker (Scheduler); der Testversand lässt ihn unangetastet.
 * Wirft nie — Fehler werden geloggt und als {sent:false} gemeldet.
 */
export async function sendPeriodReport(
  companyId: number,
  period: ReportPeriod,
  refDate: Date = new Date(),
  opts: { updateLastSent?: boolean } = {}
): Promise<SendReportResult> {
  const range = previousPeriodRange(period, refDate);
  const base: SendReportResult = { sent: false, period, from: range.from, to: range.to, title: range.title };
  try {
    const mail = await EmailSettings.findOne();
    if (!mail || !mail.isActive) return { ...base, reason: 'SMTP_INACTIVE' };

    const settings = await settingsController.getOrCreateSettings(companyId);
    const recipients = await resolveRecipients(settings, companyId);
    if (recipients.length === 0) return { ...base, reason: 'NO_RECIPIENTS' };

    const report = await buildPeriodReport(companyId, range.from, range.to);

    const periodLine = range.from === range.to
      ? `Zeitraum: ${ddmmyyyy(range.from)}`
      : `Zeitraum: ${ddmmyyyy(range.from)} – ${ddmmyyyy(range.to)}`;
    const bodyHtml = report.rows.length === 0
      ? `<p>${escapeHtml(periodLine)}</p>
         <div style="background-color:#FFF7ED;border-left:4px solid ${MAIL_PRIMARY};padding:14px;margin:16px 0;border-radius:0 8px 8px 0;">
           <p style="color:#9a3412;margin:0;">Im Berichtszeitraum liegen keine erfassten Arbeitstage vor.</p>
         </div>`
      : `<p>${escapeHtml(periodLine)}</p>${buildReportTableHtml(report)}
         <p style="color:#6B7280;font-size:13px;">Soll/Ist/Saldo in Stunden:Minuten · Auffälligkeiten = unvollständige bzw. markierte Tage (ArbZG, Auto-Kappung u. ä.).</p>`;

    const html = await renderBrandedEmail({
      title: range.title,
      bodyHtml,
      footerNote: 'Automatischer Bericht des TimeFeed-Berichtssystems (Einstellungen → Benachrichtigungen).',
    });

    // month/quarter/year: zusätzlich XLSX-Anhang mit Übersicht + allen Tagen.
    const attachments = period === 'day' ? undefined : [{
      filename: `TimeFeed_${range.title.replace(/[^\wÄÖÜäöüß.-]+/g, '_')}.xlsx`,
      content: await buildReportXlsx(report, range.title),
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }];

    await emailService.sendEmail(recipients, `TimeFeed: ${range.title}`, html, undefined, attachments);

    if (opts.updateLastSent) {
      const lastSent = parseLastSent(settings.reportLastSent);
      lastSent[period] = range.key;
      await settings.update({ reportLastSent: JSON.stringify(lastSent) });
    }
    console.log(`ReportMail: ${range.title} (Firma ${companyId}) an ${recipients.length} Empfänger gesendet.`);
    return { ...base, sent: true, recipients: recipients.length };
  } catch (e: any) {
    console.error(`ReportMail: Versand fehlgeschlagen (Firma ${companyId}, ${period}):`, e?.message);
    return { ...base, reason: 'SEND_FAILED' };
  }
}

// ---------------------------------------------------------------------------
// Scheduler (setTimeout-Rescheduling wie autoBackupService, Tick 05:00)
// ---------------------------------------------------------------------------

let ticking = false;

/**
 * Täglicher Tick: für jede Firma mit aktivierten Berichten prüfen, was heute
 * fällig ist (day: täglich; month: am 1.; quarter: 1.1./1.4./1.7./1.10.;
 * year: 1.1.) und noch nicht verschickt wurde (reportLastSent-Gate).
 */
export async function runReportTick(now: Date = new Date()): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const due = duePeriodsOn(now);
    const allSettings = await SystemSettings.findAll({
      where: {
        companyId: { [Op.ne]: null },
        [Op.or]: [
          { reportDailyEnabled: true }, { reportMonthlyEnabled: true },
          { reportQuarterlyEnabled: true }, { reportYearlyEnabled: true },
        ],
      } as any,
    });

    for (const settings of allSettings) {
      const companyId = settings.companyId as number;
      const enabled: Record<ReportPeriod, boolean> = {
        day: !!settings.reportDailyEnabled,
        month: !!settings.reportMonthlyEnabled,
        quarter: !!settings.reportQuarterlyEnabled,
        year: !!settings.reportYearlyEnabled,
      };
      for (const period of due) {
        if (!enabled[period]) continue;
        const { key } = previousPeriodRange(period, now);
        if (!shouldSendPeriod(settings.reportLastSent, period, key)) continue; // bereits verschickt
        await sendPeriodReport(companyId, period, now, { updateLastSent: true });
      }
    }
  } catch (e: any) {
    console.error('ReportMail: Tick fehlgeschlagen:', e?.message);
  } finally {
    ticking = false;
  }
}

let timer: NodeJS.Timeout | null = null;

/** Täglichen 05:00-Tick starten (Aufruf aus index.ts beim Serverstart). */
export function startReportMailJob(): void {
  if (timer) return;
  const schedule = () => {
    const now = new Date();
    const next = computeNextRun(REPORT_TICK_TIME, now);
    timer = setTimeout(async () => {
      timer = null;
      await runReportTick().catch((e) => console.error('ReportMail-Lauf fehlgeschlagen:', e));
      schedule(); // nächsten Lauf planen (robust gegen DST-Wechsel)
    }, next.getTime() - now.getTime());
    if (timer.unref) timer.unref();
    console.log(`ReportMail-Job geplant (nächster Tick ${next.toLocaleString('de-DE')}).`);
  };
  schedule();
}

export function stopReportMailJob(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}
