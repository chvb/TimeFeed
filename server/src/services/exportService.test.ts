import {
  buildCsv,
  buildLodas,
  buildLug,
  buildRow,
  csvSafe,
  DEFAULT_PROFILE,
  ExportProfileLike,
  ExportRow,
  fmtHours,
  monthToMMJJJJ,
  toAnsi,
} from './exportService';

/**
 * exportService-Tests: reine Format-/Aggregations-Logik, KEINE DB nötig
 * (jest.setup.js setzt trotzdem sqlite::memory: für die Modell-Imports).
 */

const profile = (over: Partial<ExportProfileLike> = {}): ExportProfileLike => ({
  ...DEFAULT_PROFILE,
  format: 'lodas',
  beraterNr: '1234567',
  mandantenNr: '54321',
  lohnartNormal: '200',
  lohnartOvertime: '201',
  overtimeMode: 'balance',
  ...over,
});

// Fixer Datensatz: 160h Ist, 152h Soll → 8h Überstunden (balance-Modus).
const rowMueller: ExportRow = {
  userId: 7,
  personalNr: '1001',
  name: 'Jörg Müller',
  sollMinutes: 152 * 60,
  istMinutes: 160 * 60,
  breakMinutes: 600,
  saldoMinutes: 8 * 60,
  overtimeMinutes: 8 * 60,
  incompleteDays: 0,
  absenceDays: 2,
  closed: true,
};

const rowNoNr: ExportRow = {
  userId: 8,
  personalNr: '',
  name: 'Lisa Weber',
  sollMinutes: 80 * 60,
  istMinutes: 75 * 60 + 30,
  breakMinutes: 300,
  saldoMinutes: -(4 * 60) - 30,
  overtimeMinutes: 0,
  incompleteDays: 1,
  absenceDays: 0,
  closed: true,
};

describe('buildRow (Überstunden-Modi, PersonalNr-Quelle)', () => {
  const wds = [
    { userId: 7, date: '2026-06-01', targetMinutes: 480, workedMinutes: 540, breakMinutes: 30, autoBreakMinutes: 0, balanceMinutes: 60, status: 'ok', absence: null },
    { userId: 7, date: '2026-06-02', targetMinutes: 480, workedMinutes: 510, breakMinutes: 0, autoBreakMinutes: 30, balanceMinutes: 30, status: 'ok', absence: null },
    { userId: 7, date: '2026-06-03', targetMinutes: 480, workedMinutes: 0, breakMinutes: 0, autoBreakMinutes: 0, balanceMinutes: 0, status: 'ok', absence: 'vacation' },
  ];
  const user = { id: 7, firstName: 'Jörg', lastName: 'Müller', employeeNumber: '1001' };

  it('summiert Ist/Soll/Pausen/Saldo und zählt Abwesenheitstage', () => {
    const r = buildRow(profile({ overtimeMode: 'none' }), user, wds, true);
    expect(r.istMinutes).toBe(1050);
    expect(r.sollMinutes).toBe(1440);
    expect(r.breakMinutes).toBe(60);
    expect(r.saldoMinutes).toBe(90);
    expect(r.absenceDays).toBe(1);
    expect(r.personalNr).toBe('1001');
  });

  it("overtimeMode 'none' → keine Überstunden", () => {
    const r = buildRow(profile({ overtimeMode: 'none' }), user, wds, true);
    expect(r.overtimeMinutes).toBe(0);
  });

  it("overtimeMode 'balance' → positiver Monatssaldo als Überstunden", () => {
    const r = buildRow(profile({ overtimeMode: 'balance' }), user, wds, true);
    expect(r.overtimeMinutes).toBe(90);
  });

  it("overtimeMode 'balance' → negativer Saldo ergibt 0 Überstunden", () => {
    const minus = wds.map((d) => ({ ...d, balanceMinutes: -60 }));
    const r = buildRow(profile({ overtimeMode: 'balance' }), user, minus, true);
    expect(r.overtimeMinutes).toBe(0);
  });

  it("personalNrSource 'userId' nutzt die User-ID, fehlende employeeNumber → leere PersonalNr", () => {
    const noNr = { ...user, employeeNumber: null };
    expect(buildRow(profile({ personalNrSource: 'userId' }), noNr, wds, true).personalNr).toBe('7');
    expect(buildRow(profile(), noNr, wds, true).personalNr).toBe('');
  });
});

describe('buildLodas (Snapshot mit fixem Datensatz)', () => {
  it('erzeugt Kopfblock + Bewegungsdaten inkl. Überstunden-Split', () => {
    const out = buildLodas(profile(), '2026-06', [rowMueller, rowNoNr]);
    expect(out).toBe([
      '[Allgemein]',
      'Ziel=LODAS',
      'Version_SST=1.0',
      'BeraterNr=1234567',
      'MandantenNr=54321',
      'Abrechnungszeitraum=062026',
      'Feldtrennzeichen=;',
      'Zahlenkomma=,',
      'Kommentarzeichen=*',
      '',
      '* Lohnbuchungen (Stunden) aus TimeFeed fuer 062026.',
      '* Aufbau best-effort nach LODAS-ASCII-Doku - vor Produktivimport mit',
      '* einer Beispieldatei des Steuerberaters abgleichen (Testimport!).',
      '',
      '[Bewegungsdaten]',
      '1001;200;152,00;', // Normal = Ist(160) − Überstunden(8)
      '1001;201;8,00;',
      ';200;75,50;', // fehlende PersonalNr → leeres Feld, Zeile bleibt drin
      '',
    ].join('\r\n'));
  });

  it('ohne lohnartOvertime laufen alle Ist-Stunden auf die Normal-Lohnart', () => {
    const out = buildLodas(profile({ lohnartOvertime: null }), '2026-06', [rowMueller]);
    expect(out).toContain('1001;200;160,00;');
    expect(out).not.toContain(';201;');
  });

  it('decimalComma=false → Dezimalpunkt und Zahlenkomma=.', () => {
    const out = buildLodas(profile({ decimalComma: false }), '2026-06', [rowMueller]);
    expect(out).toContain('Zahlenkomma=.');
    expect(out).toContain('1001;200;152.00;');
    expect(out).toContain('1001;201;8.00;');
  });
});

describe('buildLug (Snapshot mit fixem Datensatz)', () => {
  it('erzeugt Kopfzeile + MandantenNr;PersonalNr;Lohnart;Stunden', () => {
    const out = buildLug(profile(), '2026-06', [rowMueller, rowNoNr]);
    expect(out).toBe([
      'MandantenNr;PersonalNr;Lohnart;Stunden',
      '54321;1001;200;152,00',
      '54321;1001;201;8,00',
      '54321;;200;75,50',
      '',
    ].join('\r\n'));
  });
});

describe('buildCsv', () => {
  it('enthält BOM, Kopfzeile und alle Summenspalten', () => {
    const out = buildCsv(profile(), [rowMueller]);
    expect(out.charCodeAt(0)).toBe(0xfeff);
    expect(out).toContain('PersonalNr;Name;Soll (h);Ist (h);Pausen (h);Saldo (h);Überstunden (h);Fehltage (incomplete);Abwesenheitstage');
    expect(out).toContain('"1001";"Jörg Müller";152,00;160,00;10,00;8,00;8,00;0;2');
  });

  it('wehrt Formel-Injection in Namen/PersonalNr ab', () => {
    const evil: ExportRow = { ...rowMueller, personalNr: '=1+1', name: '=cmd|\'/C calc\'!A0 "x"' };
    const out = buildCsv(profile(), [evil]);
    expect(out).toContain(`"'=1+1"`);
    expect(out).toContain(`"'=cmd|'/C calc'!A0 ""x"""`);
    // Keine Zelle beginnt mit einem rohen Formelzeichen.
    expect(out).not.toMatch(/;"=/);
  });

  it('decimalComma=false → Dezimalpunkte', () => {
    const out = buildCsv(profile({ decimalComma: false }), [rowMueller]);
    expect(out).toContain(';152.00;160.00;');
  });
});

describe('Helfer', () => {
  it('fmtHours rundet auf 2 Nachkommastellen (Komma/Punkt)', () => {
    expect(fmtHours(90, true)).toBe('1,50');
    expect(fmtHours(90, false)).toBe('1.50');
    expect(fmtHours(-135, true)).toBe('-2,25');
    expect(fmtHours(50, true)).toBe('0,83');
  });

  it('monthToMMJJJJ', () => {
    expect(monthToMMJJJJ('2026-06')).toBe('062026');
    expect(monthToMMJJJJ('2025-12')).toBe('122025');
  });

  it('toAnsi kodiert Umlaute als Latin-1-Bytes, ersetzt Nicht-Latin-1', () => {
    const buf = toAnsi('Müß€');
    expect(buf[0]).toBe(0x4d); // M
    expect(buf[1]).toBe(0xfc); // ü
    expect(buf[2]).toBe(0xdf); // ß
    expect(buf[3]).toBe(0x3f); // € → '?'
  });

  it('csvSafe neutralisiert führende Formelzeichen und verdoppelt Anführungszeichen', () => {
    expect(csvSafe('=SUM(A1)')).toBe(`'=SUM(A1)`);
    expect(csvSafe('+49 123')).toBe(`'+49 123`);
    expect(csvSafe('@import')).toBe(`'@import`);
    expect(csvSafe('Meier "Max"')).toBe('Meier ""Max""');
    expect(csvSafe('normal')).toBe('normal');
  });
});
