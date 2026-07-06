// Druckausgabe „Monats-Stundenzettel": gebrandetes Print-HTML (brand.ts) mit
// Tages-Tabelle, Summen und Unterschriftszeilen — im Stil der Feed-Familie.
import { printHeaderHtml, printFooterHtml } from '../components/common/brand';
import { escapeHtml } from './escapeHtml';
import { minutesToHM, timeHHMM } from './timeFormat';

export interface PrintDayRow {
  date: string;
  targetMinutes: number;
  workedMinutes: number;
  breakMinutes: number;
  autoBreakMinutes: number;
  balanceMinutes: number;
  status: string;
  absence?: string | null;
  firstIn?: string | null;
  lastOut?: string | null;
}

interface PrintLabels {
  title: string;          // „Monats-Stundenzettel"
  colDate: string;
  colIn: string;
  colOut: string;
  colBreak: string;
  colWorked: string;
  colTarget: string;
  colBalance: string;
  colStatus: string;
  sums: string;           // „Summen"
  signatureEmployee: string;
  signatureEmployer: string;
  closedNote?: string;    // z. B. „Monat abgeschlossen am …" (optional)
  statusText: (day: PrintDayRow) => string; // übersetzter Status/Abwesenheit
}

function signed(min: number): string {
  return `${min < 0 ? '-' : '+'}${minutesToHM(Math.abs(min))}`;
}

/** Öffnet ein Druckfenster mit dem Monats-Stundenzettel eines Mitarbeiters. */
export function printMonthTimesheet(opts: {
  employeeName: string;
  monthLabel: string;
  days: PrintDayRow[];
  labels: PrintLabels;
  locale: string;
}): void {
  const { employeeName, monthLabel, days, labels, locale } = opts;

  const sums = days.reduce(
    (acc, d) => {
      acc.target += d.targetMinutes;
      acc.worked += d.workedMinutes;
      acc.balance += d.balanceMinutes;
      acc.breaks += d.breakMinutes + d.autoBreakMinutes;
      return acc;
    },
    { target: 0, worked: 0, balance: 0, breaks: 0 }
  );

  const fmtDate = (date: string) =>
    new Date(`${date}T00:00:00`).toLocaleDateString(locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });

  const rows = days.map((d) => `
    <tr>
      <td>${escapeHtml(fmtDate(d.date))}</td>
      <td style="text-align:center">${escapeHtml(timeHHMM(d.firstIn, locale))}</td>
      <td style="text-align:center">${escapeHtml(timeHHMM(d.lastOut, locale))}</td>
      <td style="text-align:right">${minutesToHM(d.breakMinutes + d.autoBreakMinutes)}</td>
      <td style="text-align:right">${minutesToHM(d.workedMinutes)}</td>
      <td style="text-align:right">${minutesToHM(d.targetMinutes)}</td>
      <td style="text-align:right">${escapeHtml(signed(d.balanceMinutes))}</td>
      <td>${escapeHtml(labels.statusText(d))}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(labels.title)} — ${escapeHtml(employeeName)}</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: Arial, sans-serif; font-size: 11px; color: #0f172a; margin: 0; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th { background: #f1f5f9; padding: 6px 6px; text-align: left; font-weight: bold; border-bottom: 2px solid #cbd5e1; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; }
  th.num { text-align: right; }
  th.center { text-align: center; }
  td { padding: 5px 6px; border-bottom: 1px solid #e5e7eb; }
  tfoot td { font-weight: bold; border-top: 2px solid #cbd5e1; border-bottom: none; background: #f8fafc; }
  .closed-note { margin-top: 8px; font-size: 10px; color: #64748b; }
  .signatures { display: flex; gap: 40px; margin-top: 60px; }
  .signature { flex: 1; border-top: 1px solid #334155; padding-top: 6px; font-size: 10px; color: #334155; }
</style>
</head>
<body>
  ${printHeaderHtml(labels.title, `${employeeName} · ${monthLabel}`)}
  <table>
    <thead>
      <tr>
        <th>${escapeHtml(labels.colDate)}</th>
        <th class="center">${escapeHtml(labels.colIn)}</th>
        <th class="center">${escapeHtml(labels.colOut)}</th>
        <th class="num">${escapeHtml(labels.colBreak)}</th>
        <th class="num">${escapeHtml(labels.colWorked)}</th>
        <th class="num">${escapeHtml(labels.colTarget)}</th>
        <th class="num">${escapeHtml(labels.colBalance)}</th>
        <th>${escapeHtml(labels.colStatus)}</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
    <tfoot>
      <tr>
        <td colspan="3">${escapeHtml(labels.sums)} · ${escapeHtml(monthLabel)}</td>
        <td style="text-align:right">${minutesToHM(sums.breaks)}</td>
        <td style="text-align:right">${minutesToHM(sums.worked)}</td>
        <td style="text-align:right">${minutesToHM(sums.target)}</td>
        <td style="text-align:right">${escapeHtml(signed(sums.balance))}</td>
        <td></td>
      </tr>
    </tfoot>
  </table>
  ${labels.closedNote ? `<p class="closed-note">${escapeHtml(labels.closedNote)}</p>` : ''}
  <div class="signatures">
    <div class="signature">${escapeHtml(labels.signatureEmployee)}</div>
    <div class="signature">${escapeHtml(labels.signatureEmployer)}</div>
  </div>
  ${printFooterHtml()}
</body>
</html>`;

  const w = window.open('', '', 'width=900,height=700');
  if (!w) return;
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); w.close(); }, 250);
}
