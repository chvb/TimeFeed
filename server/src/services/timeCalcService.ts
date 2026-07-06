import { Op } from 'sequelize';
import { TimeEntry, TimeEntrySource, TimeEntryType } from '../models/TimeEntry';
import { WorkDay, WorkDayStatus } from '../models/WorkDay';
import { User } from '../models/User';
import { Group } from '../models/Group';
import { TimeModel, RoundingMode } from '../models/TimeModel';
import { SystemSettings } from '../models/SystemSettings';
import { SettingsController } from '../controllers/settings.controller';
import { HolidayService } from './holidayService';

/**
 * timeCalcService — Kernberechnung der Zeiterfassung.
 *
 * Grundprinzipien:
 * - Quelle der Wahrheit sind die (nicht stornierten) TimeEntries; WorkDay ist ein
 *   reproduzierbares Aggregat und wird hier geupsertet.
 * - Nachtschicht: ein 'out' nach Mitternacht gehört zum Arbeitstag des zugehörigen
 *   'in'. Die Zuordnung erfolgt über Paar-Bildung in ZEITLICHER Reihenfolge
 *   (Schichtlogik), nicht über den Kalendertag des Stempels.
 * - 'approved'/'locked' WorkDays werden NIE überschrieben.
 */

// ---------------------------------------------------------------------------
// Zeit-Helfer (lokale Zeitzone des Servers = Betriebs-Zeitzone der Firma)
// ---------------------------------------------------------------------------

/** Lokales YYYY-MM-DD eines Zeitpunkts. */
export function ymdLocal(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Lokale Tagesgrenze 00:00 für ein YYYY-MM-DD. */
export function localDayStart(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

export function addDays(d: Date, days: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + days);
  return r;
}

const minutesBetween = (a: Date, b: Date): number => Math.round((b.getTime() - a.getTime()) / 60000);

// ---------------------------------------------------------------------------
// Paar-Bildung (pure, testbar)
// ---------------------------------------------------------------------------

export interface StampLike {
  type: TimeEntryType;
  timestamp: Date;
  lat?: number | null;
  lng?: number | null;
  source?: TimeEntrySource | string;
}

export interface Shift {
  inAt: Date;
  outAt: Date | null;
  /** Gestempelte (gepaarte) Pausenminuten innerhalb der Schicht. */
  stampedBreakMinutes: number;
  /** Offene (nicht beendete) Pause — Beginn-Zeitpunkt, sonst null. */
  breakOpenSince: Date | null;
  /** Mind. ein Web-/Terminal-Stempel ohne GPS-Koordinaten. */
  missingGps: boolean;
  /** Enthält einen automatisch gekappten 'out' (source auto_cap). */
  autoCapped: boolean;
}

/**
 * Paart Stempelungen in zeitlicher Reihenfolge zu Schichten (in→out) mit
 * Pausenintervallen (break_start→break_end). Verwaiste/unpassende Stempel
 * (out ohne in, break außerhalb einer Schicht, doppeltes break_start) werden
 * ignoriert; ein zweites 'in' ohne vorheriges 'out' schließt die alte Schicht
 * als offen (fehlendes out) ab und beginnt eine neue.
 */
export function pairShifts(entries: StampLike[]): Shift[] {
  const sorted = [...entries].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const shifts: Shift[] = [];
  let current: Shift | null = null;

  const entryMissesGps = (e: StampLike): boolean =>
    (e.source === 'web' || e.source === 'terminal') && (e.lat == null || e.lng == null);

  for (const e of sorted) {
    switch (e.type) {
      case 'in':
        if (current) shifts.push(current); // vergessenes out → Schicht bleibt offen
        current = {
          inAt: e.timestamp,
          outAt: null,
          stampedBreakMinutes: 0,
          breakOpenSince: null,
          missingGps: entryMissesGps(e),
          autoCapped: false,
        };
        break;
      case 'break_start':
        if (current && !current.breakOpenSince && !current.outAt) {
          current.breakOpenSince = e.timestamp;
          current.missingGps = current.missingGps || entryMissesGps(e);
        }
        break;
      case 'break_end':
        if (current && current.breakOpenSince) {
          current.stampedBreakMinutes += Math.max(0, minutesBetween(current.breakOpenSince, e.timestamp));
          current.breakOpenSince = null;
          current.missingGps = current.missingGps || entryMissesGps(e);
        }
        break;
      case 'out':
        if (current) {
          // Offene Pause wird durch das 'out' beendet (zählt bis zum out).
          if (current.breakOpenSince) {
            current.stampedBreakMinutes += Math.max(0, minutesBetween(current.breakOpenSince, e.timestamp));
            current.breakOpenSince = null;
          }
          current.outAt = e.timestamp;
          current.missingGps = current.missingGps || entryMissesGps(e);
          current.autoCapped = current.autoCapped || e.source === 'auto_cap';
          shifts.push(current);
          current = null;
        }
        break;
    }
  }
  if (current) shifts.push(current);
  return shifts;
}

// ---------------------------------------------------------------------------
// Pausen-/Rundungslogik (pure, testbar)
// ---------------------------------------------------------------------------

export interface BreakConfig {
  breakMode: string; // 'auto' | 'manual' | 'combined'
  breakAfter6hMinutes: number;
  breakAfter9hMinutes: number;
}

/** Gesetzliche Mindestpause (ArbZG §4) für eine Arbeitszeit in Minuten. */
export function statutoryBreakMinutes(workMinutes: number, cfg: BreakConfig): number {
  if (workMinutes > 9 * 60) return cfg.breakAfter9hMinutes;
  if (workMinutes > 6 * 60) return cfg.breakAfter6hMinutes;
  return 0;
}

export interface WorkedResult {
  grossMinutes: number;
  breakMinutes: number;      // gestempelt
  autoBreakMinutes: number;  // automatisch ergänzt
  workedMinutes: number;     // netto (vor Rundung)
}

/**
 * Berechnet Netto-Arbeitszeit über die GESCHLOSSENEN Schichten eines Tages.
 * - 'auto':     gestempelte Pausen werden IGNORIERT (nicht abgezogen); stattdessen
 *               wird die gesetzliche Pause auf die Brutto-Zeit angewendet.
 * - 'manual':   nur gestempelte Pausen werden abgezogen.
 * - 'combined': gestempelte Pausen zählen; liegt ihre Summe unter der gesetzlichen
 *               Mindestpause, wird die Differenz zusätzlich abgezogen (autoBreak).
 */
export function computeWorkedMinutes(shifts: Shift[], cfg: BreakConfig): WorkedResult {
  const closed = shifts.filter((s) => s.outAt);
  const grossMinutes = closed.reduce((sum, s) => sum + Math.max(0, minutesBetween(s.inAt, s.outAt as Date)), 0);
  const stamped = closed.reduce((sum, s) => sum + s.stampedBreakMinutes, 0);

  let autoBreakMinutes = 0;
  let workedMinutes: number;

  switch (cfg.breakMode) {
    case 'manual':
      workedMinutes = Math.max(0, grossMinutes - stamped);
      break;
    case 'combined': {
      const base = Math.max(0, grossMinutes - stamped);
      const required = statutoryBreakMinutes(base, cfg);
      autoBreakMinutes = Math.max(0, required - stamped);
      workedMinutes = Math.max(0, base - autoBreakMinutes);
      break;
    }
    case 'auto':
    default: {
      const required = statutoryBreakMinutes(grossMinutes, cfg);
      autoBreakMinutes = Math.min(required, grossMinutes);
      workedMinutes = Math.max(0, grossMinutes - autoBreakMinutes);
      break;
    }
  }

  return { grossMinutes, breakMinutes: stamped, autoBreakMinutes, workedMinutes };
}

/** Rundung der Tagessumme nach Zeitmodell. */
export function applyRounding(minutes: number, mode: RoundingMode | string | undefined, step: number | undefined): number {
  if (!mode || mode === 'none' || !step || step <= 0) return minutes;
  switch (mode) {
    case 'up': return Math.ceil(minutes / step) * step;
    case 'down': return Math.floor(minutes / step) * step;
    case 'nearest': return Math.round(minutes / step) * step;
    default: return minutes;
  }
}

// ---------------------------------------------------------------------------
// Sollzeit
// ---------------------------------------------------------------------------

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Effektives Zeitmodell eines Users: User-Override → Gruppen-Modell → null. */
export async function resolveTimeModel(user: User): Promise<TimeModel | null> {
  if (user.timeModelId) {
    const tm = await TimeModel.findByPk(user.timeModelId);
    if (tm && tm.isActive) return tm;
  }
  if (user.groupId) {
    const group = await Group.findByPk(user.groupId, { attributes: ['id', 'timeModelId'] });
    if (group?.timeModelId) {
      const tm = await TimeModel.findByPk(group.timeModelId);
      if (tm && tm.isActive) return tm;
    }
  }
  return null;
}

/**
 * Sollminuten für einen Tag: Zeitmodell-Wochentagsminuten × employmentFactor;
 * ohne Zeitmodell Fallback auf User-Overrides bzw. SystemSettings
 * (hoursPerWorkday/workingDays).
 */
export function targetMinutesForDay(
  date: string,
  timeModel: TimeModel | null,
  user: Pick<User, 'employmentFactor' | 'workingDaysOverride' | 'hoursPerDayOverride'>,
  settings: Pick<SystemSettings, 'hoursPerWorkday'> & { getParsedWorkingDays: () => string[] }
): number {
  const factor = user.employmentFactor ?? 1;
  const jsDay = localDayStart(date).getDay();
  if (timeModel) {
    return Math.round(timeModel.minutesForWeekday(jsDay) * factor);
  }
  const workingDays = user.workingDaysOverride ?? settings.getParsedWorkingDays();
  if (!workingDays.includes(WEEKDAY_NAMES[jsDay])) return 0;
  const hours = user.hoursPerDayOverride ?? settings.hoursPerWorkday;
  return Math.round(hours * 60 * factor);
}

// ---------------------------------------------------------------------------
// Tagesberechnung
// ---------------------------------------------------------------------------

const settingsController = new SettingsController();

// Flags, die den Status 'flagged' auslösen (target_credited ist rein informativ).
const FLAGGING = new Set(['arbzg_over_10h', 'arbzg_rest_violation', 'auto_capped', 'no_gps']);

/**
 * Berechnet das Tagesaggregat (WorkDay) eines Users für einen Kalendertag
 * (lokales YYYY-MM-DD) und upsertet es. 'approved'/'locked' bleiben unberührt.
 *
 * Abwesenheits-/Feiertagsregel: Ist der Tag ein gesetzlicher Feiertag (oder eine
 * extern gesetzte Abwesenheit wie vacation/sick vorhanden), zählt der Tag als
 * ERFÜLLT: targetMinutes wird auf 0 gesetzt (Sollzeit-Gutschrift), das Flag
 * 'target_credited' dokumentiert das, und balanceMinutes = workedMinutes − 0 —
 * tatsächlich gearbeitete Zeit an einem Feiertag zählt also voll als Plus.
 */
export async function calcWorkDay(userId: number, date: string): Promise<WorkDay | null> {
  const user = await User.findByPk(userId);
  if (!user) return null;

  const existing = await WorkDay.findOne({ where: { userId, date } });
  if (existing && (existing.status === 'approved' || existing.status === 'locked')) {
    return existing; // abgenommene/gesperrte Tage NIE überschreiben
  }

  const dayStart = localDayStart(date);
  const dayEnd = addDays(dayStart, 1);

  // Fenster [Vortag 00:00, übernächster Tag 00:00): so sehen wir sowohl eine am
  // Vortag begonnene Schicht (deren Stempel am Morgen NICHT zu diesem Tag gehören)
  // als auch das 'out' einer Nachtschicht dieses Tages nach Mitternacht.
  const entries = await TimeEntry.findAll({
    where: {
      userId,
      isCancelled: false,
      timestamp: { [Op.gte]: addDays(dayStart, -1), [Op.lt]: addDays(dayStart, 2) },
    },
    order: [['timestamp', 'ASC']],
  });

  const allShifts = pairShifts(entries.map((e) => ({
    type: e.type, timestamp: new Date(e.timestamp), lat: e.lat, lng: e.lng, source: e.source,
  })));
  // Schichten dieses Arbeitstags = Schichten, deren 'in' auf diesen Kalendertag fällt.
  const dayShifts = allShifts.filter((s) => ymdLocal(s.inAt) === date);
  const openShift = dayShifts.find((s) => !s.outAt) || null;

  const settings = await settingsController.getOrCreateSettings(user.companyId ?? null);
  const timeModel = await resolveTimeModel(user);

  // Ist-Zeit (nur geschlossene Schichten) + Rundung der Tagessumme.
  const worked = computeWorkedMinutes(dayShifts, settings);
  const workedMinutes = applyRounding(worked.workedMinutes, timeModel?.roundingMode, timeModel?.roundingMinutes);

  // Sollzeit
  let targetMinutes = targetMinutesForDay(date, timeModel, user, settings);

  // Abwesenheit: Feiertag automatisch; extern gesetzte Abwesenheit (vacation/sick,
  // z. B. via UrlaubsFeed-Kopplung) bleibt erhalten.
  const holidays = await HolidayService.getHolidaysForDateRange(dayStart, new Date(dayEnd.getTime() - 1), user.companyId ?? null);
  const isHoliday = holidays.some((h) => h.type === 'national');
  let absence: string | null = existing?.absence ?? null;
  if (isHoliday) absence = 'holiday';

  const flags: string[] = [];
  if (absence) {
    // Sollzeit-Gutschrift (siehe Funktions-Doku): Tag gilt als erfüllt.
    targetMinutes = 0;
    flags.push('target_credited');
  }

  // 'no_gps' nur markieren, wenn der GPS-Modus es verlangt ('warn'/'required') --
  // bei 'off'/'optional' ist Stempeln ohne Standort ausdruecklich in Ordnung.
  const gpsMode = (settings as any).gpsMode || 'optional';
  if ((gpsMode === 'warn' || gpsMode === 'required') && dayShifts.some((s) => s.missingGps)) flags.push('no_gps');
  if (dayShifts.some((s) => s.autoCapped)) flags.push('auto_capped');

  const firstIn = dayShifts.length > 0 ? dayShifts[0].inAt : null;
  const outs = dayShifts.filter((s) => s.outAt).map((s) => (s.outAt as Date).getTime());
  const lastOut = outs.length > 0 ? new Date(Math.max(...outs)) : null;

  // ArbZG-Prüfungen
  if (settings.arbzgWarningsEnabled) {
    if (workedMinutes > settings.arbzgMaxDailyMinutes) flags.push('arbzg_over_10h');
    if (firstIn) {
      const prev = await WorkDay.findOne({ where: { userId, date: ymdLocal(addDays(dayStart, -1)) } });
      if (prev?.lastOut) {
        const rest = minutesBetween(new Date(prev.lastOut), firstIn);
        if (rest < settings.arbzgMinRestMinutes) flags.push('arbzg_rest_violation');
      }
    }
  }

  // Status: offene Schicht am HEUTIGEN Tag = 'open' (läuft noch); an Vortagen
  // 'incomplete' (Ausstempeln vergessen). Ohne Stempel und ohne Abwesenheit 'open'.
  const today = ymdLocal(new Date());
  let status: WorkDayStatus;
  if (openShift) {
    status = date === today ? 'open' : 'incomplete';
  } else if (dayShifts.length === 0 && !absence) {
    status = 'open';
  } else if (flags.some((f) => FLAGGING.has(f))) {
    status = 'flagged';
  } else {
    status = 'ok';
  }

  const values = {
    userId,
    companyId: user.companyId ?? null,
    date,
    targetMinutes,
    workedMinutes,
    breakMinutes: worked.breakMinutes,
    autoBreakMinutes: worked.autoBreakMinutes,
    balanceMinutes: workedMinutes - targetMinutes,
    status,
    flags,
    absence,
    firstIn,
    lastOut,
  };

  if (existing) {
    await existing.update(values);
    return existing;
  }
  try {
    return await WorkDay.create(values);
  } catch (e: any) {
    // Paralleler Erstlauf (Unique userId+date): vorhandene Zeile aktualisieren.
    if (e?.name === 'SequelizeUniqueConstraintError') {
      const row = await WorkDay.findOne({ where: { userId, date } });
      if (row && row.status !== 'approved' && row.status !== 'locked') await row.update(values);
      return row;
    }
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Aktueller Stempel-Zustand eines Users (für /api/time/status und Validierung)
// ---------------------------------------------------------------------------

export type StampState = 'out' | 'in' | 'break';

export interface UserTimeState {
  state: StampState;
  /** Beginn des aktuellen Zustands (eingestempelt seit / Pause seit), null wenn 'out'. */
  since: Date | null;
  /** 'in' der aktuell offenen Schicht (null wenn ausgestempelt). */
  shiftStartedAt: Date | null;
}

/**
 * Zustand aus den letzten 48h Stempelungen ableiten (deckt Nachtschichten ab).
 * Optional `at`: Zustand zu einem Zeitpunkt in der Vergangenheit (für die
 * tolerante Sequenzvalidierung beim Offline-Nachsync von Terminal-Stempeln).
 */
export async function getUserTimeState(userId: number, at?: Date): Promise<UserTimeState> {
  const ref = at ?? new Date();
  const entries = await TimeEntry.findAll({
    where: {
      userId,
      isCancelled: false,
      timestamp: {
        [Op.gte]: new Date(ref.getTime() - 48 * 3600 * 1000),
        [Op.lte]: ref,
      },
    },
    order: [['timestamp', 'ASC']],
  });
  const shifts = pairShifts(entries.map((e) => ({
    type: e.type, timestamp: new Date(e.timestamp), lat: e.lat, lng: e.lng, source: e.source,
  })));
  const last = shifts.length > 0 ? shifts[shifts.length - 1] : null;
  if (!last || last.outAt) return { state: 'out', since: null, shiftStartedAt: null };
  if (last.breakOpenSince) return { state: 'break', since: last.breakOpenSince, shiftStartedAt: last.inAt };
  return { state: 'in', since: last.inAt, shiftStartedAt: last.inAt };
}

// ---------------------------------------------------------------------------
// Sequenzvalidierung (pure, testbar) — gemeinsame Logik für Web- UND
// Terminal-Stempelungen (time.controller + terminalApi.controller).
// ---------------------------------------------------------------------------

export type SequenceConflictCode = 'ALREADY_IN' | 'NOT_IN' | 'BREAK_OPEN' | 'NO_BREAK';

export interface SequenceConflict {
  code: SequenceConflictCode;
  message: string;
}

/**
 * Prüft, ob ein Stempel-Typ zum aktuellen Zustand passt.
 * Rückgabe null = Stempel ist zulässig; sonst der 409-Konflikt (Code + Meldung).
 */
export function validateStampSequence(state: StampState, type: TimeEntryType): SequenceConflict | null {
  switch (type) {
    case 'in':
      if (state === 'break') return { code: 'BREAK_OPEN', message: 'Es läuft noch eine Pause.' };
      if (state === 'in') return { code: 'ALREADY_IN', message: 'Sie sind bereits eingestempelt.' };
      return null;
    case 'out':
      if (state === 'out') return { code: 'NOT_IN', message: 'Sie sind nicht eingestempelt.' };
      if (state === 'break') return { code: 'BREAK_OPEN', message: 'Bitte zuerst die Pause beenden.' };
      return null;
    case 'break_start':
      if (state === 'out') return { code: 'NOT_IN', message: 'Sie sind nicht eingestempelt.' };
      if (state === 'break') return { code: 'BREAK_OPEN', message: 'Es läuft bereits eine Pause.' };
      return null;
    case 'break_end':
      if (state !== 'break') return { code: 'NO_BREAK', message: 'Es läuft keine Pause.' };
      return null;
    default:
      return null;
  }
}
