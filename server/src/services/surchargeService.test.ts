import {
  breakIntervalsForShift,
  computeMonthSurcharges,
  hhmmToMinutes,
  overlapMinutes,
  surchargeMinutesForShift,
  windowOccurrences,
} from './surchargeService';
import { pairShifts, StampLike } from './timeCalcService';
import { SurchargeWindow } from '../models/SurchargeProfile';

/**
 * surchargeService-Tests: reine Fenster-Schnitt-Logik, KEINE DB nötig
 * (jest.setup.js setzt trotzdem sqlite::memory: für die Modell-Imports).
 */

const d = (iso: string) => new Date(iso);

/** Stempel-Kurzform: [type, iso][] → StampLike[]. */
const stamps = (list: Array<[string, string]>): StampLike[] =>
  list.map(([type, iso]) => ({ type: type as any, timestamp: d(iso), source: 'manual' }));

const NIGHT: SurchargeWindow = { from: '20:00', to: '06:30', lohnart: '1010', percent: 25, label: 'Nachtarbeit' };
const EVENING: SurchargeWindow = { from: '18:00', to: '20:00', lohnart: '1005', percent: 10, label: 'Spätarbeit' };

describe('hhmmToMinutes / overlapMinutes', () => {
  it('parst HH:MM und lehnt Unfug ab', () => {
    expect(hhmmToMinutes('20:00')).toBe(1200);
    expect(hhmmToMinutes('06:30')).toBe(390);
    expect(hhmmToMinutes('24:00')).toBeNull();
    expect(hhmmToMinutes('7:5')).toBeNull();
    expect(hhmmToMinutes('')).toBeNull();
  });

  it('overlapMinutes: Schnittmenge, nie negativ', () => {
    expect(overlapMinutes(d('2026-06-01T22:00'), d('2026-06-02T06:00'), d('2026-06-01T20:00'), d('2026-06-02T06:30'))).toBe(480);
    expect(overlapMinutes(d('2026-06-01T08:00'), d('2026-06-01T12:00'), d('2026-06-01T13:00'), d('2026-06-01T14:00'))).toBe(0);
  });
});

describe('windowOccurrences (Fenster über Mitternacht)', () => {
  it('20:00–06:30 erzeugt Über-Mitternacht-Vorkommen inkl. Vortag', () => {
    // Schicht 02:00–05:00 → das Fenster des VORTAGS (20:00–06:30) muss greifen.
    const occ = windowOccurrences(NIGHT, d('2026-06-02T02:00'), d('2026-06-02T05:00'));
    expect(occ.some((o) => o.start.getTime() === d('2026-06-01T20:00').getTime()
      && o.end.getTime() === d('2026-06-02T06:30').getTime())).toBe(true);
  });

  it('Tages-Fenster (to > from) bleibt am selben Tag', () => {
    const occ = windowOccurrences(EVENING, d('2026-06-01T17:00'), d('2026-06-01T21:00'));
    expect(occ).toHaveLength(1);
    expect(occ[0].start.getTime()).toBe(d('2026-06-01T18:00').getTime());
    expect(occ[0].end.getTime()).toBe(d('2026-06-01T20:00').getTime());
  });

  it('ungültige Zeiten → keine Vorkommen', () => {
    expect(windowOccurrences({ ...NIGHT, from: 'xx' }, d('2026-06-01T00:00'), d('2026-06-02T00:00'))).toEqual([]);
  });
});

describe('surchargeMinutesForShift (Nachtschicht 20:00–06:30)', () => {
  it('Schicht 22:00–06:00 ∩ Fenster 20:00–06:30 = 480 min (brutto/auto)', () => {
    const [shift] = pairShifts(stamps([['in', '2026-06-01T22:00'], ['out', '2026-06-02T06:00']]));
    expect(surchargeMinutesForShift(shift, [], NIGHT, 'auto')).toBe(480);
  });

  it('Schicht 18:00–23:00: nur der Teil ab 20:00 zählt (180 min)', () => {
    const [shift] = pairShifts(stamps([['in', '2026-06-01T18:00'], ['out', '2026-06-01T23:00']]));
    expect(surchargeMinutesForShift(shift, [], NIGHT, 'auto')).toBe(180);
  });

  it('offene Schicht (kein out) zählt nicht', () => {
    const [shift] = pairShifts(stamps([['in', '2026-06-01T22:00']]));
    expect(surchargeMinutesForShift(shift, [], NIGHT, 'auto')).toBe(0);
  });
});

describe('breakIntervalsForShift (Pausenintervalle nach pairShifts-Regeln)', () => {
  it('paart break_start/break_end und schließt offene Pausen mit dem out', () => {
    const entries = stamps([
      ['in', '2026-06-01T22:00'],
      ['break_start', '2026-06-02T00:30'],
      ['break_end', '2026-06-02T01:00'],
      ['break_start', '2026-06-02T05:30'], // offen → endet mit out
      ['out', '2026-06-02T06:00'],
    ]);
    const [shift] = pairShifts(entries);
    const breaks = breakIntervalsForShift(entries, shift);
    expect(breaks).toHaveLength(2);
    expect(breaks[0].start.getTime()).toBe(d('2026-06-02T00:30').getTime());
    expect(breaks[0].end.getTime()).toBe(d('2026-06-02T01:00').getTime());
    expect(breaks[1].end.getTime()).toBe(d('2026-06-02T06:00').getTime());
    // Summe muss der pairShifts-Pausensumme entsprechen (gleiche Regeln).
    const sum = breaks.reduce((s, b) => s + Math.round((b.end.getTime() - b.start.getTime()) / 60000), 0);
    expect(sum).toBe(shift.stampedBreakMinutes);
  });
});

describe('computeMonthSurcharges', () => {
  it('Nachtschicht 22:00–06:00, Pause 00:30–01:00 → manual zieht die Pause ab', () => {
    const entries = stamps([
      ['in', '2026-06-01T22:00'],
      ['break_start', '2026-06-02T00:30'],
      ['break_end', '2026-06-02T01:00'],
      ['out', '2026-06-02T06:00'],
    ]);
    const r = computeMonthSurcharges(entries, '2026-06', [NIGHT], 'manual');
    expect(r.totals).toEqual([{ lohnart: '1010', percent: 25, minutes: 450, label: 'Nachtarbeit' }]);
    // Nachtschicht-Regel: alles auf dem Arbeitstag des 'in' (01.06.).
    expect(r.days).toEqual([{ date: '2026-06-01', entries: [{ lohnart: '1010', percent: 25, minutes: 450, label: 'Nachtarbeit' }] }]);
  });

  it("'combined' zieht gestempelte Pausen ebenfalls ab", () => {
    const entries = stamps([
      ['in', '2026-06-01T22:00'],
      ['break_start', '2026-06-02T00:30'],
      ['break_end', '2026-06-02T01:00'],
      ['out', '2026-06-02T06:00'],
    ]);
    const r = computeMonthSurcharges(entries, '2026-06', [NIGHT], 'combined');
    expect(r.totals[0].minutes).toBe(450);
  });

  it("'auto' rechnet brutto (gestempelte Pausen werden ignoriert — wie computeWorkedMinutes)", () => {
    const entries = stamps([
      ['in', '2026-06-01T22:00'],
      ['break_start', '2026-06-02T00:30'],
      ['break_end', '2026-06-02T01:00'],
      ['out', '2026-06-02T06:00'],
    ]);
    const r = computeMonthSurcharges(entries, '2026-06', [NIGHT], 'auto');
    expect(r.totals[0].minutes).toBe(480);
  });

  it('Pause außerhalb des Fensters reduziert den Schnitt nicht (manual)', () => {
    const entries = stamps([
      ['in', '2026-06-01T18:00'],
      ['break_start', '2026-06-01T19:00'], // vor 20:00 → außerhalb des Nachtfensters
      ['break_end', '2026-06-01T19:30'],
      ['out', '2026-06-01T23:00'],
    ]);
    const r = computeMonthSurcharges(entries, '2026-06', [NIGHT], 'manual');
    expect(r.totals[0].minutes).toBe(180); // 20:00–23:00
  });

  it('mehrere Fenster: Spät- und Nachtzuschlag je eigene Lohnart', () => {
    const entries = stamps([['in', '2026-06-01T17:00'], ['out', '2026-06-02T02:00']]);
    const r = computeMonthSurcharges(entries, '2026-06', [NIGHT, EVENING], 'auto');
    const night = r.totals.find((t) => t.lohnart === '1010');
    const evening = r.totals.find((t) => t.lohnart === '1005');
    expect(night?.minutes).toBe(360); // 20:00–02:00
    expect(evening?.minutes).toBe(120); // 18:00–20:00
  });

  it('mehrere Schichten im Monat werden je Lohnart aggregiert', () => {
    const entries = stamps([
      ['in', '2026-06-01T22:00'], ['out', '2026-06-02T06:00'], // 480
      ['in', '2026-06-03T21:00'], ['out', '2026-06-04T05:00'], // 480
    ]);
    const r = computeMonthSurcharges(entries, '2026-06', [NIGHT], 'auto');
    expect(r.totals).toEqual([{ lohnart: '1010', percent: 25, minutes: 960, label: 'Nachtarbeit' }]);
    expect(r.days.map((x) => x.date)).toEqual(['2026-06-01', '2026-06-03']);
  });

  it('Schichten mit in außerhalb des Monats zählen nicht (Monatsgrenze)', () => {
    const entries = stamps([
      ['in', '2026-05-31T22:00'], ['out', '2026-06-01T06:00'], // in im Mai → zählt für Mai
      ['in', '2026-06-30T22:00'], ['out', '2026-07-01T06:00'], // in im Juni → zählt (auch nach Mitternacht)
    ]);
    const june = computeMonthSurcharges(entries, '2026-06', [NIGHT], 'auto');
    expect(june.days.map((x) => x.date)).toEqual(['2026-06-30']);
    expect(june.totals[0].minutes).toBe(480);
    const may = computeMonthSurcharges(entries, '2026-05', [NIGHT], 'auto');
    expect(may.days.map((x) => x.date)).toEqual(['2026-05-31']);
  });

  it('ohne gültige Fenster bzw. ohne Schnitt → leeres Ergebnis', () => {
    const entries = stamps([['in', '2026-06-01T08:00'], ['out', '2026-06-01T16:00']]);
    expect(computeMonthSurcharges(entries, '2026-06', [], 'auto')).toEqual({ days: [], totals: [] });
    expect(computeMonthSurcharges(entries, '2026-06', [NIGHT], 'auto')).toEqual({ days: [], totals: [] });
    expect(computeMonthSurcharges(entries, '2026-06', [{ ...NIGHT, lohnart: ' ' }], 'auto')).toEqual({ days: [], totals: [] });
  });
});
