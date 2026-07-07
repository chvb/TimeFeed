import {
  previousPeriodRange,
  duePeriodsOn,
  parseLastSent,
  shouldSendPeriod,
  parseRecipients,
  aggregateReportRows,
  fmtHM,
} from './reportMailService';

/**
 * Periodengrenzen (Vortag/Monatswechsel/Quartale/Jahr, schaltjahr-sicher über
 * feste Dates), Doppelversand-Gate (reportLastSent) und Empfänger-Auflösung
 * (Komma-Liste) — alles pure Helfer ohne DB.
 */

describe('reportMailService — previousPeriodRange (day)', () => {
  test('normaler Tag → Vortag', () => {
    const r = previousPeriodRange('day', new Date(2026, 6, 6, 5, 0)); // 06.07.2026
    expect(r.from).toBe('2026-07-05');
    expect(r.to).toBe('2026-07-05');
    expect(r.key).toBe('2026-07-05');
    expect(r.title).toBe('Tagesbericht 05.07.2026');
  });

  test('Monatsanfang → letzter Tag des Vormonats', () => {
    const r = previousPeriodRange('day', new Date(2026, 2, 1, 5, 0)); // 01.03.2026
    expect(r.from).toBe('2026-02-28'); // 2026 ist KEIN Schaltjahr
  });

  test('Schaltjahr: 01.03.2024 → 29.02.2024', () => {
    const r = previousPeriodRange('day', new Date(2024, 2, 1, 5, 0));
    expect(r.from).toBe('2024-02-29');
    expect(r.key).toBe('2024-02-29');
  });

  test('Jahresanfang → 31.12. des Vorjahres', () => {
    const r = previousPeriodRange('day', new Date(2026, 0, 1, 5, 0));
    expect(r.from).toBe('2025-12-31');
  });
});

describe('reportMailService — previousPeriodRange (month)', () => {
  test('mitten im Monat → kompletter Vormonat', () => {
    const r = previousPeriodRange('month', new Date(2026, 6, 6)); // Juli → Juni
    expect(r.from).toBe('2026-06-01');
    expect(r.to).toBe('2026-06-30');
    expect(r.key).toBe('2026-06');
    expect(r.title).toBe('Monatsbericht Juni 2026');
  });

  test('Januar → Dezember des Vorjahres', () => {
    const r = previousPeriodRange('month', new Date(2026, 0, 1));
    expect(r.from).toBe('2025-12-01');
    expect(r.to).toBe('2025-12-31');
    expect(r.key).toBe('2025-12');
    expect(r.title).toBe('Monatsbericht Dezember 2025');
  });

  test('Schaltjahr: März 2024 → Februar mit 29 Tagen', () => {
    const r = previousPeriodRange('month', new Date(2024, 2, 1));
    expect(r.from).toBe('2024-02-01');
    expect(r.to).toBe('2024-02-29');
    expect(r.key).toBe('2024-02');
  });
});

describe('reportMailService — previousPeriodRange (quarter)', () => {
  test('im Q1 → Q4 des Vorjahres', () => {
    const r = previousPeriodRange('quarter', new Date(2026, 0, 1)); // 01.01.2026
    expect(r.from).toBe('2025-10-01');
    expect(r.to).toBe('2025-12-31');
    expect(r.key).toBe('2025-Q4');
    expect(r.title).toBe('Quartalsbericht Q4 2025');
  });

  test('im Q2 → Q1 (inkl. Schaltjahr-Februar)', () => {
    const r = previousPeriodRange('quarter', new Date(2024, 3, 1)); // 01.04.2024
    expect(r.from).toBe('2024-01-01');
    expect(r.to).toBe('2024-03-31');
    expect(r.key).toBe('2024-Q1');
  });

  test('im Q3 → Q2', () => {
    const r = previousPeriodRange('quarter', new Date(2026, 6, 6)); // 06.07.2026
    expect(r.from).toBe('2026-04-01');
    expect(r.to).toBe('2026-06-30');
    expect(r.key).toBe('2026-Q2');
    expect(r.title).toBe('Quartalsbericht Q2 2026');
  });

  test('im Q4 → Q3', () => {
    const r = previousPeriodRange('quarter', new Date(2026, 9, 1)); // 01.10.2026
    expect(r.from).toBe('2026-07-01');
    expect(r.to).toBe('2026-09-30');
    expect(r.key).toBe('2026-Q3');
  });
});

describe('reportMailService — previousPeriodRange (year)', () => {
  test('→ komplettes Vorjahr', () => {
    const r = previousPeriodRange('year', new Date(2026, 0, 1));
    expect(r.from).toBe('2025-01-01');
    expect(r.to).toBe('2025-12-31');
    expect(r.key).toBe('2025');
    expect(r.title).toBe('Jahresbericht 2025');
  });

  test('Schaltjahr als Vorjahr (2025 → 2024)', () => {
    const r = previousPeriodRange('year', new Date(2025, 5, 15));
    expect(r.from).toBe('2024-01-01');
    expect(r.to).toBe('2024-12-31');
    expect(r.key).toBe('2024');
  });
});

describe('reportMailService — duePeriodsOn', () => {
  test('normaler Tag → nur day', () => {
    expect(duePeriodsOn(new Date(2026, 6, 6))).toEqual(['day']);
  });
  test('Monatserster (kein Quartal) → day+month', () => {
    expect(duePeriodsOn(new Date(2026, 1, 1))).toEqual(['day', 'month']); // 01.02.
  });
  test('Quartalserster → day+month+quarter', () => {
    expect(duePeriodsOn(new Date(2026, 6, 1))).toEqual(['day', 'month', 'quarter']); // 01.07.
    expect(duePeriodsOn(new Date(2026, 3, 1))).toEqual(['day', 'month', 'quarter']); // 01.04.
    expect(duePeriodsOn(new Date(2026, 9, 1))).toEqual(['day', 'month', 'quarter']); // 01.10.
  });
  test('01.01. → alle vier Perioden', () => {
    expect(duePeriodsOn(new Date(2026, 0, 1))).toEqual(['day', 'month', 'quarter', 'year']);
  });
});

describe('reportMailService — lastSent-Gate', () => {
  test('kein Merker → senden', () => {
    expect(shouldSendPeriod(null, 'day', '2026-07-05')).toBe(true);
    expect(shouldSendPeriod(undefined, 'month', '2026-06')).toBe(true);
    expect(shouldSendPeriod('', 'year', '2025')).toBe(true);
  });

  test('gleicher Key → NICHT erneut senden', () => {
    const raw = JSON.stringify({ day: '2026-07-05', month: '2026-06', quarter: '2026-Q2', year: '2025' });
    expect(shouldSendPeriod(raw, 'day', '2026-07-05')).toBe(false);
    expect(shouldSendPeriod(raw, 'month', '2026-06')).toBe(false);
    expect(shouldSendPeriod(raw, 'quarter', '2026-Q2')).toBe(false);
    expect(shouldSendPeriod(raw, 'year', '2025')).toBe(false);
  });

  test('anderer Key (neue Periode) → senden', () => {
    const raw = JSON.stringify({ day: '2026-07-05' });
    expect(shouldSendPeriod(raw, 'day', '2026-07-06')).toBe(true);
    expect(shouldSendPeriod(raw, 'month', '2026-06')).toBe(true); // Periode noch nie gesendet
  });

  test('kaputtes JSON → defensiv senden', () => {
    expect(shouldSendPeriod('{nicht json', 'day', '2026-07-05')).toBe(true);
    expect(shouldSendPeriod('[1,2]', 'day', '2026-07-05')).toBe(true);
    expect(parseLastSent('{broken')).toEqual({});
  });
});

describe('reportMailService — Empfänger-Auflösung (parseRecipients)', () => {
  test('leer/null → leere Liste (Aufrufer fällt auf Admins zurück)', () => {
    expect(parseRecipients('')).toEqual([]);
    expect(parseRecipients(null)).toEqual([]);
    expect(parseRecipients(undefined)).toEqual([]);
  });

  test('Komma-Liste mit Leerzeichen/Leereinträgen', () => {
    expect(parseRecipients('a@b.de, c@d.de,,  e@f.de ')).toEqual(['a@b.de', 'c@d.de', 'e@f.de']);
  });
});

describe('reportMailService — aggregateReportRows', () => {
  const users = [
    { id: 1, firstName: 'Lisa', lastName: 'Weber', employeeNumber: 'P001' },
    { id: 2, firstName: 'Max', lastName: 'Mustermann', employeeNumber: null },
    { id: 3, firstName: 'Ohne', lastName: 'Tage', employeeNumber: 'P003' },
  ];
  const wd = (userId: number, date: string, extra: any = {}) => ({
    userId, date, targetMinutes: 480, workedMinutes: 480, balanceMinutes: 0,
    status: 'ok', flags: [] as string[], absence: null, ...extra,
  });

  test('Soll/Ist/Saldo, Abwesenheiten je Art, incomplete/flagged + Firmensummen', () => {
    const workDays = [
      wd(1, '2026-06-01', { workedMinutes: 510, balanceMinutes: 30 }),
      wd(1, '2026-06-02', { workedMinutes: 0, targetMinutes: 0, absence: 'vacation', flags: ['target_credited'] }),
      wd(1, '2026-06-03', { workedMinutes: 0, targetMinutes: 0, absence: 'vacation', flags: ['target_credited'] }),
      wd(1, '2026-06-04', { workedMinutes: 0, targetMinutes: 0, absence: 'sick', flags: ['target_credited'] }),
      wd(1, '2026-06-05', { workedMinutes: 240, balanceMinutes: -240, status: 'incomplete' }),
      wd(2, '2026-06-01', { workedMinutes: 660, balanceMinutes: 180, status: 'flagged', flags: ['arbzg_over_10h'] }),
      wd(2, '2026-06-02', { flags: ['auto_capped'] }), // status ok, aber Warn-Flag → auffällig
    ];
    const { rows, totals } = aggregateReportRows(users, workDays);

    // User 3 hat keine WorkDays → erscheint nicht.
    expect(rows.map((r) => r.userId)).toEqual([1, 2]);

    const lisa = rows[0];
    expect(lisa.name).toBe('Lisa Weber');
    expect(lisa.personalNr).toBe('P001');
    expect(lisa.sollMin).toBe(480 + 0 + 0 + 0 + 480);
    expect(lisa.istMin).toBe(510 + 240);
    expect(lisa.saldoMin).toBe(30 - 240);
    expect(lisa.absenceDays).toEqual({ vacation: 2, sick: 1 });
    expect(lisa.incompleteDays).toBe(1);
    expect(lisa.flaggedDays).toBe(0); // 'target_credited' zählt NICHT als Auffälligkeit

    const max = rows[1];
    expect(max.personalNr).toBe('');
    expect(max.flaggedDays).toBe(2); // status flagged + auto_capped

    expect(totals.sollMin).toBe(lisa.sollMin + max.sollMin);
    expect(totals.istMin).toBe(lisa.istMin + max.istMin);
    expect(totals.saldoMin).toBe(lisa.saldoMin + max.saldoMin);
    expect(totals.absenceDays).toBe(3);
    expect(totals.incompleteDays).toBe(1);
    expect(totals.flaggedDays).toBe(2);
  });

  test('flags als JSON-String (SQLite-Rohwert) werden defensiv geparst', () => {
    const workDays = [wd(1, '2026-06-01', { flags: '["arbzg_rest_violation"]' })];
    const { rows } = aggregateReportRows(users, workDays as any);
    expect(rows[0].flaggedDays).toBe(1);
  });

  test('leerer Zeitraum → keine Zeilen, Null-Summen', () => {
    const { rows, totals } = aggregateReportRows(users, []);
    expect(rows).toEqual([]);
    expect(totals).toEqual({ sollMin: 0, istMin: 0, saldoMin: 0, absenceDays: 0, incompleteDays: 0, flaggedDays: 0 });
  });
});

describe('reportMailService — fmtHM', () => {
  test('Minuten → H:MM', () => {
    expect(fmtHM(0)).toBe('0:00');
    expect(fmtHM(495)).toBe('8:15');
    expect(fmtHM(-90)).toBe('1:30'); // Vorzeichen setzt der Aufrufer
  });
});
