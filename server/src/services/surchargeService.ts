import { Op } from 'sequelize';
import { TimeEntry } from '../models/TimeEntry';
import { User } from '../models/User';
import { Group } from '../models/Group';
import { SurchargeProfile, SurchargeWindow } from '../models/SurchargeProfile';
import { pairShifts, Shift, StampLike, ymdLocal, localDayStart, addDays } from './timeCalcService';
import { monthEndDate } from './monthLockService';

/**
 * surchargeService — Zuschläge für gesonderte Zeitspannen (Yellowfox-Parität
 * Paket 2, z. B. Nachtarbeit 20:00–06:00 → Lohnart 1010, 25 %).
 *
 * Grundprinzip: Für einen User+Monat werden die NICHT-stornierten TimeEntries
 * zu Schichten gepaart (pairShifts aus timeCalcService — dieselbe Logik wie die
 * WorkDay-Berechnung) und je Zuschlagsfenster die Schnittmenge in Minuten
 * berechnet. Ein Fenster mit to <= from läuft über Mitternacht (20:00–06:30).
 *
 * Pausenbehandlung (konsistent zu computeWorkedMinutes):
 * - 'manual'/'combined': gestempelte Pausenintervalle werden aus den Fenstern
 *   herausgerechnet (eine 00:30–01:00-Pause reduziert den Nacht-Schnitt).
 *   Die im 'combined'-Modus ggf. ZUSÄTZLICH abgezogene gesetzliche Restpause
 *   hat keine Uhrzeit-Position und kann daher keinem Fenster zugeordnet
 *   werden — sie bleibt unberücksichtigt (bewusste Näherung).
 * - 'auto': Brutto-Schnitt. Der Auto-Modus IGNORIERT gestempelte Pausen auch
 *   bei der Ist-Zeit und zieht stattdessen die gesetzliche Pause pauschal ab;
 *   diese Pauschale hat keine Uhrzeit-Position, also gibt es nichts, was man
 *   positionsgenau aus einem Fenster schneiden könnte.
 *
 * Tages-Zuordnung wie bei WorkDay (Nachtschicht-Regel): eine Schicht gehört
 * zum Kalendertag ihres 'in' — auch die Fenster-Minuten nach Mitternacht.
 */

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface SurchargeEntry {
  lohnart: string;
  percent: number;
  minutes: number;
  label: string;
}

export interface SurchargeDay {
  date: string; // YYYY-MM-DD (Arbeitstag = Tag des Schichtbeginns)
  entries: SurchargeEntry[];
}

export interface MonthSurcharges {
  /** Je Arbeitstag mit Fenster-Schnitt die Zuschläge (aggregiert je Lohnart). */
  days: SurchargeDay[];
  /** Monats-Summen, aggregiert je Lohnart. */
  totals: SurchargeEntry[];
}

export interface Interval {
  start: Date;
  end: Date;
}

// ---------------------------------------------------------------------------
// Pure Helfer (testbar ohne DB)
// ---------------------------------------------------------------------------

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/** 'HH:MM' → Minuten seit 00:00, null bei ungültiger Eingabe. */
export function hhmmToMinutes(s: string): number | null {
  const m = HHMM_RE.exec(String(s || '').trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/** Überlappung zweier Intervalle in Minuten (>= 0, minutengenau gerundet). */
export function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, Math.round((end - start) / 60000));
}

/**
 * Konkrete Vorkommen eines Zuschlagsfensters über einer Zeitspanne:
 * Für jeden Kalendertag, dessen Fenster-Vorkommen die Spanne berühren kann,
 * wird [Tag+from, Tag+to] gebildet; to <= from = Fensterende am Folgetag
 * (über Mitternacht). Ungültige from/to-Werte ⇒ keine Vorkommen.
 */
export function windowOccurrences(win: SurchargeWindow, rangeStart: Date, rangeEnd: Date): Interval[] {
  const fromMin = hhmmToMinutes(win.from);
  const toMin = hhmmToMinutes(win.to);
  if (fromMin == null || toMin == null) return [];
  const spansMidnight = toMin <= fromMin;

  const out: Interval[] = [];
  // Vortag mit einbeziehen: ein Über-Mitternacht-Fenster des Vortags kann in
  // die Spanne hineinreichen (z. B. Schicht ab 02:00, Fenster 20:00–06:30).
  let day = addDays(localDayStart(ymdLocal(rangeStart)), -1);
  const lastDay = localDayStart(ymdLocal(rangeEnd));
  while (day.getTime() <= lastDay.getTime()) {
    const start = new Date(day.getTime() + fromMin * 60000);
    const end = spansMidnight
      ? new Date(addDays(day, 1).getTime() + toMin * 60000)
      : new Date(day.getTime() + toMin * 60000);
    if (end > rangeStart && start < rangeEnd) out.push({ start, end });
    day = addDays(day, 1);
  }
  return out;
}

/**
 * Gestempelte Pausenintervalle einer GESCHLOSSENEN Schicht aus den rohen
 * Stempeln ableiten — mit denselben Paarungs-Regeln wie pairShifts
 * (break_start öffnet nur, wenn keine Pause offen ist; break_end bzw. das
 * 'out' der Schicht schließt sie). pairShifts selbst liefert nur die
 * Pausen-SUMME, für den Fenster-Schnitt brauchen wir die Intervalle.
 */
export function breakIntervalsForShift(entries: StampLike[], shift: Shift): Interval[] {
  if (!shift.outAt) return [];
  const inT = shift.inAt.getTime();
  const outT = shift.outAt.getTime();
  const within = [...entries]
    .filter((e) => {
      const t = e.timestamp.getTime();
      return t >= inT && t <= outT && (e.type === 'break_start' || e.type === 'break_end');
    })
    .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  const out: Interval[] = [];
  let open: Date | null = null;
  for (const e of within) {
    if (e.type === 'break_start' && !open) open = e.timestamp;
    else if (e.type === 'break_end' && open) {
      if (e.timestamp > open) out.push({ start: open, end: e.timestamp });
      open = null;
    }
  }
  // Offene Pause endet mit dem 'out' (wie in pairShifts).
  if (open && shift.outAt > open) out.push({ start: open, end: shift.outAt });
  return out;
}

/**
 * Fenster-Minuten einer geschlossenen Schicht: Schnitt Schicht ∩ Fenster,
 * bei breakMode 'manual'/'combined' abzüglich der Pausen-∩-Fenster-Minuten
 * ('auto': Brutto — siehe Modul-Doku).
 */
export function surchargeMinutesForShift(
  shift: Shift,
  breaks: Interval[],
  win: SurchargeWindow,
  breakMode: string
): number {
  if (!shift.outAt) return 0; // offene Schichten zählen nicht (wie computeWorkedMinutes)
  let minutes = 0;
  for (const occ of windowOccurrences(win, shift.inAt, shift.outAt)) {
    let part = overlapMinutes(shift.inAt, shift.outAt, occ.start, occ.end);
    if (part <= 0) continue;
    if (breakMode === 'manual' || breakMode === 'combined') {
      for (const b of breaks) part -= overlapMinutes(b.start, b.end, occ.start, occ.end);
    }
    minutes += Math.max(0, part);
  }
  return minutes;
}

/** Zuschläge in eine Liste aggregieren (je Lohnart; Label/Prozent der ersten Quelle). */
function addEntry(list: SurchargeEntry[], e: SurchargeEntry): void {
  if (e.minutes <= 0) return;
  const existing = list.find((x) => x.lohnart === e.lohnart);
  if (existing) existing.minutes += e.minutes;
  else list.push({ ...e });
}

/**
 * Kern-Berechnung (pure): Zuschläge eines Users für einen Monat aus seinen
 * Stempeln. Schichten werden mit pairShifts gebildet; eine Schicht zählt zum
 * Monat, wenn ihr 'in' im Monat liegt (Nachtschicht-Regel wie WorkDay).
 * Ergebnis je Tag + Monatssumme, aggregiert je Lohnart.
 */
export function computeMonthSurcharges(
  entries: StampLike[],
  month: string, // YYYY-MM
  windows: SurchargeWindow[],
  breakMode: string
): MonthSurcharges {
  const result: MonthSurcharges = { days: [], totals: [] };
  const valid = (windows || []).filter(
    (w) => w && hhmmToMinutes(w.from) != null && hhmmToMinutes(w.to) != null && String(w.lohnart || '').trim()
  );
  if (valid.length === 0) return result;

  const shifts = pairShifts(entries).filter((s) => s.outAt && ymdLocal(s.inAt).startsWith(`${month}-`));
  const byDay = new Map<string, SurchargeEntry[]>();

  for (const shift of shifts) {
    const breaks = breakIntervalsForShift(entries, shift);
    const day = ymdLocal(shift.inAt);
    for (const win of valid) {
      const minutes = surchargeMinutesForShift(shift, breaks, win, breakMode);
      if (minutes <= 0) continue;
      const entry: SurchargeEntry = {
        lohnart: String(win.lohnart).trim(),
        percent: Number(win.percent) || 0,
        minutes,
        label: String(win.label || '').trim(),
      };
      const list = byDay.get(day) || [];
      addEntry(list, entry);
      byDay.set(day, list);
      addEntry(result.totals, entry);
    }
  }

  result.days = [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([date, list]) => ({ date, entries: list }));
  return result;
}

// ---------------------------------------------------------------------------
// DB-Anbindung
// ---------------------------------------------------------------------------

/**
 * Effektives Zuschlagsprofil eines Users: User-Override → Gruppen-Profil → null
 * (exakt das Zuordnungs-Muster von resolveTimeModel; inaktive Profile zählen nicht).
 */
export async function resolveSurchargeProfile(
  user: Pick<User, 'surchargeProfileId' | 'groupId'>
): Promise<SurchargeProfile | null> {
  if (user.surchargeProfileId) {
    const p = await SurchargeProfile.findByPk(user.surchargeProfileId);
    if (p && p.isActive) return p;
  }
  if (user.groupId) {
    const group = await Group.findByPk(user.groupId, { attributes: ['id', 'surchargeProfileId'] });
    if (group?.surchargeProfileId) {
      const p = await SurchargeProfile.findByPk(group.surchargeProfileId);
      if (p && p.isActive) return p;
    }
  }
  return null;
}

/**
 * Zuschläge eines Users für einen Monat aus den NICHT-stornierten TimeEntries.
 * breakMode kommt vom Aufrufer (Firmen-Settings — exportService lädt sie ohnehin).
 * Ohne (aktives) Profil bzw. ohne Fenster: leeres Ergebnis.
 */
export async function surchargesForUserMonth(
  user: Pick<User, 'id' | 'surchargeProfileId' | 'groupId'>,
  month: string,
  breakMode: string
): Promise<MonthSurcharges> {
  const profile = await resolveSurchargeProfile(user);
  const windows = profile?.getParsedWindows() || [];
  if (windows.length === 0) return { days: [], totals: [] };

  // Fenster [Monatsanfang 00:00, Monatsende + 2 Tage): deckt das 'out' einer
  // Nachtschicht des letzten Monatstags ab. Schichten mit 'in' außerhalb des
  // Monats filtert computeMonthSurcharges heraus.
  const start = localDayStart(`${month}-01`);
  const end = addDays(localDayStart(monthEndDate(month)), 2);
  const entries = await TimeEntry.findAll({
    where: {
      userId: user.id,
      isCancelled: false,
      timestamp: { [Op.gte]: start, [Op.lt]: end },
    },
    order: [['timestamp', 'ASC']],
  });

  const stamps: StampLike[] = entries.map((e) => ({
    type: e.type, timestamp: new Date(e.timestamp), lat: e.lat, lng: e.lng, source: e.source,
  }));
  return computeMonthSurcharges(stamps, month, windows, breakMode);
}
