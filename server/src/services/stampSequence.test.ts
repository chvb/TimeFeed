import { validateStampSequence, StampState } from './timeCalcService';
import { TimeEntryType } from '../models/TimeEntry';

/**
 * Unit-Tests der extrahierten Sequenzvalidierung (gemeinsame Logik für
 * Web-Stempeln in time.controller UND Terminal-Stempeln in terminalApi.controller).
 */
describe('validateStampSequence', () => {
  const cases: Array<[StampState, TimeEntryType, string | null]> = [
    // state, type, erwarteter Konflikt-Code (null = zulässig)
    ['out', 'in', null],
    ['in', 'in', 'ALREADY_IN'],
    ['break', 'in', 'BREAK_OPEN'],

    ['out', 'out', 'NOT_IN'],
    ['in', 'out', null],
    ['break', 'out', 'BREAK_OPEN'],

    ['out', 'break_start', 'NOT_IN'],
    ['in', 'break_start', null],
    ['break', 'break_start', 'BREAK_OPEN'],

    ['out', 'break_end', 'NO_BREAK'],
    ['in', 'break_end', 'NO_BREAK'],
    ['break', 'break_end', null],
  ];

  it.each(cases)('state=%s + type=%s → %s', (state, type, expected) => {
    const conflict = validateStampSequence(state, type);
    if (expected === null) {
      expect(conflict).toBeNull();
    } else {
      expect(conflict).not.toBeNull();
      expect(conflict!.code).toBe(expected);
      expect(conflict!.message.length).toBeGreaterThan(0);
    }
  });

  it('liefert für jeden Konflikt einen der vier vereinbarten Codes', () => {
    const allowed = new Set(['ALREADY_IN', 'NOT_IN', 'BREAK_OPEN', 'NO_BREAK']);
    for (const [state, type] of cases) {
      const conflict = validateStampSequence(state, type);
      if (conflict) expect(allowed.has(conflict.code)).toBe(true);
    }
  });
});
