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
  LugUser,
  monthToMMJJJJ,
  monthToMMSlashJJJJ,
  rowLohnarten,
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
  absences: [],
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
  absences: [],
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

describe('rowLohnarten (Lohnarten-Aufschlüsselung, Monatsblick)', () => {
  const p = profile({
    lohnartFeiertag: '900',
    absenceLohnarten: { vacation: '1600', sick: '1650' },
  });

  it('mappt Abwesenheits-SOLL-Stunden je Art auf die konfigurierte Lohnart', () => {
    const row: ExportRow = {
      ...rowMueller,
      absences: [
        { key: 'vacation', minutes: 2 * 480, days: 2 },
        { key: 'sick', minutes: 480, days: 1 },
        { key: 'holiday', minutes: 480, days: 1 },
      ],
    };
    const { entries, missing } = rowLohnarten(p, row);
    expect(entries).toEqual([
      { lohnart: '200', minutes: 152 * 60, source: 'work' },
      { lohnart: '201', minutes: 8 * 60, source: 'overtime' },
      { lohnart: '1600', minutes: 960, source: 'vacation' },
      { lohnart: '1650', minutes: 480, source: 'sick' },
      { lohnart: '900', minutes: 480, source: 'holiday' },
    ]);
    expect(missing).toEqual([]);
  });

  it('Arten ohne Lohnart-Nummer werden NICHT exportiert und landen in missing', () => {
    const row: ExportRow = {
      ...rowMueller,
      absences: [
        { key: 'doctor', minutes: 480, days: 1 },
        { key: 'vacation', minutes: 480, days: 1 },
      ],
    };
    const { entries, missing } = rowLohnarten(p, row);
    expect(entries.some((e) => e.source === 'doctor')).toBe(false);
    expect(entries).toContainEqual({ lohnart: '1600', minutes: 480, source: 'vacation' });
    expect(missing).toEqual([{ absenceKey: 'doctor', days: 1 }]);
  });

  it('Feiertag ohne lohnartFeiertag → missing-Hinweis (holiday)', () => {
    const noHoliday = profile({ absenceLohnarten: { vacation: '1600' }, lohnartFeiertag: null });
    const row: ExportRow = { ...rowMueller, absences: [{ key: 'holiday', minutes: 480, days: 1 }] };
    const { entries, missing } = rowLohnarten(noHoliday, row);
    expect(entries.some((e) => e.source === 'holiday')).toBe(false);
    expect(missing).toEqual([{ absenceKey: 'holiday', days: 1 }]);
  });
});

/**
 * PFLICHT-VERIFIKATIONSTEST DATEV Lohn & Gehalt (kalendertäglich):
 * Zeile für Zeile gegen das Muster der Yellowfox-Referenzdatei
 * (scratchpad/yellowfox-export.bin — genau diese Datei importiert der
 * Steuerberater heute in DATEV):
 *   Kopf `BeraterNr;MandantenNr;MM/JJJJ`, Datenzeilen mit 11 Feldern
 *   `PersonalNr;TT;KZ;Lohnart;Stunden;1,00;;;;;`, Komma-Dezimal, CRLF,
 *   Kennzeichen U/K je Art, Feiertag ohne Feiertags-Lohnart → Normal-Lohnart.
 */
describe('buildLug (kalendertäglich, Yellowfox-Referenzformat)', () => {
  const lugProfile = profile({
    beraterNr: '501864',
    mandantenNr: '26011',
    lohnartNormal: '1000',
    lohnartFeiertag: null, // Referenz: Feiertage laufen als 8,00 auf Lohnart 1000
    absenceLohnarten: { vacation: '1600', sick: '1650' },
    overtimeMode: 'balance', // darf im LuG KEINE Rolle spielen (kalendertäglich)
  });
  const kennzeichen = { vacation: 'U', sick: 'K' };

  const users: LugUser[] = [{
    personalNr: '1026',
    days: [
      { date: '2026-05-04', workedMinutes: 585, absence: null, absenceTargetMinutes: 0 },  // 9,75 Arbeit
      { date: '2026-05-01', workedMinutes: 0, absence: 'holiday', absenceTargetMinutes: 480 }, // Feiertag → Fallback 1000
      { date: '2026-05-05', workedMinutes: 0, absence: 'vacation', absenceTargetMinutes: 480 }, // Urlaub
      { date: '2026-05-06', workedMinutes: 0, absence: 'sick', absenceTargetMinutes: 480 },     // Krank
      { date: '2026-05-07', workedMinutes: 480, absence: null, absenceTargetMinutes: 0 },   // 8,00 Arbeit
      { date: '2026-05-09', workedMinutes: 0, absence: null, absenceTargetMinutes: 0 },     // frei → KEINE Zeile
      { date: '2026-05-08', workedMinutes: 0, absence: 'doctor', absenceTargetMinutes: 480 }, // ohne Mapping → KEINE Zeile
    ],
  }];

  const out = buildLug(lugProfile, '2026-05', users, kennzeichen);
  const lines = out.split('\r\n');

  it('Kopfzeile: BeraterNr;MandantenNr;MM/JJJJ', () => {
    expect(lines[0]).toBe('501864;26011;05/2026');
    expect(monthToMMSlashJJJJ('2026-05')).toBe('05/2026');
  });

  it('Datenzeilen exakt wie die Referenz (Tage aufsteigend, U/K, Feiertag→Normal)', () => {
    expect(lines.slice(1)).toEqual([
      '1026;01;1;1000;8,00;1,00;;;;;', // Feiertag ohne Feiertags-Lohnart → Normal-Lohnart
      '1026;04;1;1000;9,75;1,00;;;;;',
      '1026;05;U;1600;8,00;1,00;;;;;',
      '1026;06;K;1650;8,00;1,00;;;;;',
      '1026;07;1;1000;8,00;1,00;;;;;',
      // 09.05. (frei) und 08.05. (doctor ohne Lohnart) erzeugen KEINE Zeile
      '', // Datei endet mit CRLF
    ]);
  });

  it('jede Datenzeile hat exakt 11 Felder (5 leere Schlussfelder) und Komma-Dezimal', () => {
    for (const line of lines.slice(1, -1)) {
      const fields = line.split(';');
      expect(fields).toHaveLength(11);
      expect(fields.slice(6)).toEqual(['', '', '', '', '']);
      expect(fields[4]).toMatch(/^\d+,\d{2}$/);
      expect(fields[5]).toBe('1,00');
      expect(fields[1]).toMatch(/^\d{2}$/); // TT zweistellig
    }
  });

  it('CRLF-Zeilenenden und reines ASCII', () => {
    expect(out.endsWith('\r\n')).toBe(true);
    // Ohne CRLF-Paare dürfen keine einzelnen CR/LF übrig bleiben.
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/);
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7F]*$/.test(out)).toBe(true);
  });

  it('minutengenaue Stunden (611 min → 10,18) und eigene Feiertags-Lohnart mit Kennzeichen', () => {
    const p2 = profile({
      beraterNr: '501864', mandantenNr: '26011', lohnartNormal: '1000',
      lohnartFeiertag: '1700', feiertagKennzeichen: 'F', absenceLohnarten: {},
    });
    const out2 = buildLug(p2, '2026-05', [{
      personalNr: '7',
      days: [
        { date: '2026-05-12', workedMinutes: 611, absence: null, absenceTargetMinutes: 0 },
        { date: '2026-05-14', workedMinutes: 0, absence: 'holiday', absenceTargetMinutes: 480 },
      ],
    }], {});
    expect(out2).toContain('7;12;1;1000;10,18;1,00;;;;;');
    expect(out2).toContain('7;14;F;1700;8,00;1,00;;;;;');
  });

  it('Arbeit UND Abwesenheit am selben Tag → zwei Zeilen (Ist + Soll)', () => {
    const out3 = buildLug(lugProfile, '2026-05', [{
      personalNr: '9',
      days: [{ date: '2026-05-20', workedMinutes: 120, absence: 'vacation', absenceTargetMinutes: 480 }],
    }], kennzeichen);
    expect(out3).toContain('9;20;1;1000;2,00;1,00;;;;;');
    expect(out3).toContain('9;20;U;1600;8,00;1,00;;;;;');
  });

  it('Zuschlags-Zusatzzeile (Nachtarbeit) ZUSÄTZLICH zur Ist-Zeile im Referenzformat', () => {
    // Nachtschicht 22:00–06:00 (8h Ist) mit 8h Fenster-Schnitt auf Lohnart 1010.
    const out4 = buildLug(lugProfile, '2026-05', [{
      personalNr: '1026',
      days: [{
        date: '2026-05-15',
        workedMinutes: 480,
        absence: null,
        absenceTargetMinutes: 0,
        surcharges: [{ lohnart: '1010', minutes: 480 }],
      }],
    }], kennzeichen);
    const dataLines = out4.split('\r\n').slice(1).filter(Boolean);
    expect(dataLines).toEqual([
      '1026;15;1;1000;8,00;1,00;;;;;', // normale Ist-Zeile
      '1026;15;1;1010;8,00;1,00;;;;;', // Zuschlags-Zusatzzeile (Yellowfox „Nachtarbeit Zuschlag")
    ]);
    // Auch die Zusatzzeile hat exakt 11 Felder.
    for (const line of dataLines) {
      expect(line.split(';')).toHaveLength(11);
    }
  });

  it('Zuschlag mit 0 Minuten erzeugt KEINE Zusatzzeile', () => {
    const out5 = buildLug(lugProfile, '2026-05', [{
      personalNr: '7',
      days: [{
        date: '2026-05-15', workedMinutes: 480, absence: null, absenceTargetMinutes: 0,
        surcharges: [{ lohnart: '1010', minutes: 0 }],
      }],
    }], kennzeichen);
    expect(out5).not.toContain(';1010;');
  });
});

describe('rowLohnarten mit Zuschlägen (LODAS/CSV/Vorschau, monatsaggregiert)', () => {
  it("Zuschläge werden als ZUSÄTZLICHE Positionen mit source 'surcharge:<label>' angehängt", () => {
    const row: ExportRow = {
      ...rowMueller,
      surcharges: [
        { lohnart: '1010', percent: 25, minutes: 960, label: 'Nachtarbeit' },
        { lohnart: '1005', percent: 10, minutes: 0, label: 'Spätarbeit' }, // 0 min → keine Position
      ],
    };
    const { entries } = rowLohnarten(profile(), row);
    // Ist-Stunden bleiben unverändert auf Normal/Überstunden …
    expect(entries).toContainEqual({ lohnart: '200', minutes: 152 * 60, source: 'work' });
    expect(entries).toContainEqual({ lohnart: '201', minutes: 8 * 60, source: 'overtime' });
    // … der Zuschlag kommt ZUSÄTZLICH dazu.
    expect(entries).toContainEqual({ lohnart: '1010', minutes: 960, source: 'surcharge:Nachtarbeit' });
    expect(entries.some((e) => e.lohnart === '1005')).toBe(false);
  });

  it('LODAS erhält eine zusätzliche Bewegungszeile je Zuschlags-Lohnart', () => {
    const row: ExportRow = {
      ...rowMueller,
      surcharges: [{ lohnart: '1010', percent: 25, minutes: 960, label: 'Nachtarbeit' }],
    };
    const out = buildLodas(profile(), '2026-06', [row]);
    expect(out).toContain('1001;200;152,00;');
    expect(out).toContain('1001;1010;16,00;');
  });

  it('CSV erhält eine eigene Lohnart-Spalte für den Zuschlag', () => {
    const row: ExportRow = {
      ...rowMueller,
      surcharges: [{ lohnart: '1010', percent: 25, minutes: 960, label: 'Nachtarbeit' }],
    };
    const out = buildCsv(profile(), [row]);
    expect(out).toContain('Lohnart 1010 (h)');
    expect(out).toContain(';16,00');
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

describe('LODAS/CSV mit Abwesenheits-Lohnarten', () => {
  const p = profile({ lohnartFeiertag: '900', absenceLohnarten: { vacation: '1600' } });
  const row: ExportRow = {
    ...rowMueller,
    absences: [
      { key: 'vacation', minutes: 960, days: 2 },
      { key: 'holiday', minutes: 480, days: 1 },
    ],
  };

  it('LODAS: zusätzliche Bewegungszeilen je Abwesenheits-Lohnart', () => {
    const out = buildLodas(p, '2026-06', [row]);
    expect(out).toContain('1001;200;152,00;');
    expect(out).toContain('1001;201;8,00;');
    expect(out).toContain('1001;1600;16,00;');
    expect(out).toContain('1001;900;8,00;');
  });

  it('CSV: eigene Spalte je Lohnart mit den gemappten Stunden', () => {
    const out = buildCsv(p, [row]);
    expect(out).toContain('Lohnart 1600 (h)');
    expect(out).toContain('Lohnart 900 (h)');
    // Zeile endet mit den Lohnarten-Spalten (Sortierung numerisch: 200,201,900,1600).
    expect(out).toContain(';152,00;8,00;8,00;16,00');
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
