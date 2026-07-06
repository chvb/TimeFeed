import {
  mondayOfWeek,
  previousMonthKey,
  monthRange,
  toYmd,
  summarizeCompanyWeek,
  summarizeOwnWeek,
  absenceRateToday,
  pickBalanceOutliers,
  autoCappedUserIds,
  computeMonthProgress,
  upcomingExits,
  upcomingBirthdays,
  evaluateBackupStatus,
  gpsMissingEnabled,
  BALANCE_OUTLIER_OVER_MINUTES,
  BALANCE_OUTLIER_UNDER_MINUTES,
  BACKUP_STALE_DAYS,
  WeekRow,
} from './feedDigestService';

// Fixe Referenz: Mittwoch, 08.07.2026 (Woche startet Montag, 06.07.).
const NOW = new Date(2026, 6, 8, 10, 30, 0, 0);
const TODAY = new Date(2026, 6, 8, 0, 0, 0, 0);

const row = (userId: number, date: string, worked: number, target: number, absence: string | null = null): WeekRow => ({
  userId, date, workedMinutes: worked, targetMinutes: target, balanceMinutes: worked - target, absence,
});

describe('feedDigestService — Zeit-Helfer', () => {
  it('mondayOfWeek liefert den Montag der laufenden Woche', () => {
    expect(mondayOfWeek(NOW).getDay()).toBe(1);
    expect(mondayOfWeek(NOW).toDateString()).toBe(new Date(2026, 6, 6).toDateString());
    // Sonntag gehört noch zur Woche ab dem Vormontag.
    expect(mondayOfWeek(new Date(2026, 6, 12, 23, 0)).toDateString()).toBe(new Date(2026, 6, 6).toDateString());
    // Montag ist sein eigener Wochenstart.
    expect(mondayOfWeek(new Date(2026, 6, 6, 0, 5)).toDateString()).toBe(new Date(2026, 6, 6).toDateString());
  });

  it('previousMonthKey + monthRange (inkl. Jahreswechsel/Schaltjahr)', () => {
    expect(previousMonthKey(NOW)).toBe('2026-06');
    expect(previousMonthKey(new Date(2026, 0, 3))).toBe('2025-12');
    expect(monthRange('2026-06')).toEqual({ startYmd: '2026-06-01', endYmd: '2026-06-30' });
    expect(monthRange('2024-02')).toEqual({ startYmd: '2024-02-01', endYmd: '2024-02-29' });
  });

  it('toYmd akzeptiert DATEONLY-Strings, ISO-Strings und Date-Objekte', () => {
    expect(toYmd('1990-05-17')).toBe('1990-05-17');
    expect(toYmd('1990-05-17T00:00:00.000Z')).toBe('1990-05-17');
    expect(toYmd(new Date(1990, 4, 17))).toBe('1990-05-17');
    expect(toYmd(null)).toBeNull();
    expect(toYmd('quatsch')).toBeNull();
  });
});

describe('feedDigestService — Wochen-Digest', () => {
  const rows: WeekRow[] = [
    row(1, '2026-07-06', 480, 480),
    row(1, '2026-07-07', 300, 480), // −180
    row(2, '2026-07-06', 500, 480), // +20
    row(2, '2026-07-07', 480, 480),
    row(3, '2026-07-08', 0, 480, 'vacation'), // heute Urlaub, −480 Saldo-Zeile hier egal
    row(99, '2026-07-06', 480, 480), // NICHT im Scope → ignorieren
  ];

  it('summarizeCompanyWeek summiert nur Scope-Mitglieder und zählt Rückstände', () => {
    const s = summarizeCompanyWeek(rows, new Set([1, 2, 3, 4]));
    expect(s.employeeCount).toBe(4);
    expect(s.workedMinutes).toBe(480 + 300 + 500 + 480 + 0);
    expect(s.targetMinutes).toBe(480 * 5);
    // User 1: −180 (Rückstand), User 3: −480 (Rückstand), User 2: +20; User 4 ohne Tage = 0.
    expect(s.behindCount).toBe(2);
    expect(s.avgBalanceMinutes).toBe(Math.round((-180 + 20 - 480 + 0) / 4));
  });

  it('summarizeOwnWeek summiert nur eigene Tage', () => {
    expect(summarizeOwnWeek(rows, 1)).toEqual({ workedMinutes: 780, targetMinutes: 960, balanceMinutes: -180 });
    expect(summarizeOwnWeek(rows, 42)).toEqual({ workedMinutes: 0, targetMinutes: 0, balanceMinutes: 0 });
  });

  it('absenceRateToday zählt nur heutige Abwesenheiten; null wenn keine', () => {
    const rate = absenceRateToday(rows, '2026-07-08', new Set([1, 2, 3, 4]));
    expect(rate).toEqual({ absentCount: 1, total: 4, byKind: { vacation: 1 } });
    expect(absenceRateToday(rows, '2026-07-07', new Set([1, 2, 3, 4]))).toBeNull();
    // Abwesende außerhalb des Scopes zählen nicht.
    expect(absenceRateToday(rows, '2026-07-08', new Set([1, 2]))).toBeNull();
  });
});

describe('feedDigestService — balance_outlier', () => {
  it('trennt über/unter den Schwellen und sortiert nach Extremwert', () => {
    const { over, under } = pickBalanceOutliers([
      { userId: 1, balanceMinutes: BALANCE_OUTLIER_OVER_MINUTES + 1 },
      { userId: 2, balanceMinutes: BALANCE_OUTLIER_OVER_MINUTES }, // genau Schwelle → kein Ausreißer
      { userId: 3, balanceMinutes: 5000 },
      { userId: 4, balanceMinutes: BALANCE_OUTLIER_UNDER_MINUTES }, // genau Schwelle → kein Ausreißer
      { userId: 5, balanceMinutes: -700 },
      { userId: 6, balanceMinutes: -2000 },
      { userId: 7, balanceMinutes: 0 },
    ]);
    expect(over.map((o) => o.userId)).toEqual([3, 1]);
    expect(under.map((o) => o.userId)).toEqual([6, 5]);
  });
});

describe('feedDigestService — auto_capped_last_night', () => {
  it('liefert eindeutige Nutzer mit auto_cap-out ab gestern 00:00', () => {
    const yStart = new Date(2026, 6, 7, 0, 0, 0, 0);
    const ids = autoCappedUserIds([
      { userId: 1, type: 'out', timestamp: new Date(2026, 6, 7, 22, 0), source: 'auto_cap' },
      { userId: 1, type: 'out', timestamp: new Date(2026, 6, 7, 23, 0), source: 'auto_cap' }, // Duplikat
      { userId: 2, type: 'out', timestamp: new Date(2026, 6, 6, 22, 0), source: 'auto_cap' }, // zu alt
      { userId: 3, type: 'out', timestamp: new Date(2026, 6, 7, 21, 0), source: 'terminal' }, // andere Quelle
      { userId: 4, type: 'in', timestamp: new Date(2026, 6, 7, 21, 0), source: 'auto_cap' }, // kein out
    ], yStart);
    expect(ids).toEqual([1]);
  });
});

describe('feedDigestService — month_progress', () => {
  const users = [
    { id: 1, companyId: 10 },
    { id: 2, companyId: 10 },
    { id: 3, companyId: 20 },
    { id: 4, companyId: null },
  ];

  it('Firmen-Abschluss (userId null) schließt alle Mitarbeiter der Firma', () => {
    expect(computeMonthProgress(users, [{ companyId: 10, userId: null }])).toEqual({ closed: 2, total: 4 });
  });

  it('Einzelabschlüsse zählen pro Nutzer; Kombination ohne Doppelzählung', () => {
    expect(computeMonthProgress(users, [
      { companyId: 10, userId: null },
      { companyId: 10, userId: 1 }, // bereits über Firma abgeschlossen
      { companyId: 20, userId: 3 },
    ])).toEqual({ closed: 3, total: 4 });
    expect(computeMonthProgress(users, [])).toEqual({ closed: 0, total: 4 });
  });
});

describe('feedDigestService — Austritte & Geburtstage', () => {
  it('upcomingExits: nur innerhalb der nächsten 30 Tage, sortiert', () => {
    const exits = upcomingExits([
      { id: 1, exitDate: '2026-07-20' },
      { id: 2, exitDate: new Date(2026, 6, 10) },
      { id: 3, exitDate: '2026-09-01' }, // zu weit weg
      { id: 4, exitDate: '2026-07-01' }, // Vergangenheit
      { id: 5 },
    ], TODAY);
    expect(exits).toEqual([
      { userId: 2, date: '2026-07-10' },
      { userId: 1, date: '2026-07-20' },
    ]);
  });

  it('upcomingBirthdays: nächstes Monats-/Tag-Auftreten in 7 Tagen, inkl. Jahreswechsel', () => {
    const bdays = upcomingBirthdays([
      { id: 1, birthDate: '1990-07-08' }, // heute
      { id: 2, birthDate: '1985-07-15' }, // letzter Tag des Fensters
      { id: 3, birthDate: '1985-07-16' }, // knapp außerhalb
      { id: 4, birthDate: '2000-01-01' }, // anderes Datum
      { id: 5, birthDate: null },
    ], TODAY);
    expect(bdays).toEqual([
      { userId: 1, date: '2026-07-08' },
      { userId: 2, date: '2026-07-15' },
    ]);

    // Jahreswechsel: 02.01. liegt vom 30.12. aus im 7-Tage-Fenster (Folgejahr).
    const wrap = upcomingBirthdays([{ id: 9, birthDate: '1970-01-02' }], new Date(2026, 11, 30));
    expect(wrap).toEqual([{ userId: 9, date: '2027-01-02' }]);
  });
});

describe('feedDigestService — gps_missing', () => {
  it('nur aktiv bei gpsMode warn/required; fehlendes Feld → aus', () => {
    expect(gpsMissingEnabled({ gpsMode: 'warn' })).toBe(true);
    expect(gpsMissingEnabled({ gpsMode: 'required' })).toBe(true);
    expect(gpsMissingEnabled({ gpsMode: 'off' })).toBe(false);
    expect(gpsMissingEnabled({})).toBe(false); // Feld existiert (noch) nicht
    expect(gpsMissingEnabled(null)).toBe(false);
    expect(gpsMissingEnabled({ gpsRequired: true })).toBe(false); // altes Feld zählt nicht
  });
});

describe('feedDigestService — backup_status', () => {
  it('nie ein Backup → reason never', () => {
    expect(evaluateBackupStatus(null, NOW)).toEqual({ reason: 'never', ageDays: null });
  });

  it('frisches Backup → null, altes Backup → stale mit Alter in Tagen', () => {
    const fresh = new Date(NOW.getTime() - (BACKUP_STALE_DAYS - 1) * 24 * 3600 * 1000).toISOString();
    expect(evaluateBackupStatus(fresh, NOW)).toBeNull();
    const stale = new Date(NOW.getTime() - (BACKUP_STALE_DAYS + 3) * 24 * 3600 * 1000).toISOString();
    expect(evaluateBackupStatus(stale, NOW)).toEqual({ reason: 'stale', ageDays: BACKUP_STALE_DAYS + 3 });
  });
});
