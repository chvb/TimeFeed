import { sequelize } from '../db/database';
import { User, TimeEntry, WorkDay, CorrectionRequest, AuditLog } from '../models';
import { UserRole } from '../models/User';
import { retentionCutoffs, runRetentionCleanup } from './timeRecalcJob';

/**
 * Tests für das Aufbewahrungs-/Löschkonzept:
 * - retentionCutoffs: Datumsgrenzen (nur ganze Monate) + Min-24-Klemme (§ 16 ArbZG).
 * - runRetentionCleanup: GPS-Nullung + monatsweises Löschen alter Zeitdaten.
 */

// Fester "Jetzt"-Zeitpunkt: 6. Juli 2026.
const NOW = new Date(2026, 6, 6, 12, 0, 0);

describe('retentionCutoffs', () => {
  it('liefert Monatsanfänge (ganze Monate) für Einträge und GPS', () => {
    const { entriesBefore, gpsBefore, entriesBeforeYmd } = retentionCutoffs(NOW, 24, 3);
    // 24 Monate vor Juli 2026 → 1. Juli 2024 00:00 lokal.
    expect(entriesBefore).toEqual(new Date(2024, 6, 1, 0, 0, 0, 0));
    expect(entriesBeforeYmd).toBe('2024-07-01');
    // 3 Monate vor Juli 2026 → 1. April 2026.
    expect(gpsBefore).toEqual(new Date(2026, 3, 1, 0, 0, 0, 0));
  });

  it('klemmt retentionMonthsEntries hart auf mindestens 24 (§ 16 Abs. 2 ArbZG)', () => {
    // Fehlkonfiguration 6 Monate darf NIE zu früherem Löschen führen.
    const { entriesBefore } = retentionCutoffs(NOW, 6, 3);
    expect(entriesBefore).toEqual(new Date(2024, 6, 1, 0, 0, 0, 0));
    // Ungültige Werte (NaN) → Default 24.
    expect(retentionCutoffs(NOW, NaN, NaN).entriesBefore).toEqual(new Date(2024, 6, 1));
  });

  it('erlaubt längere Fristen und respektiert GPS-Minimum von 1 Monat', () => {
    const { entriesBefore } = retentionCutoffs(NOW, 36, 3);
    expect(entriesBefore).toEqual(new Date(2023, 6, 1));
    const { gpsBefore } = retentionCutoffs(NOW, 24, 0);
    expect(gpsBefore).toEqual(new Date(2026, 5, 1)); // min 1 Monat
  });

  it('Jahreswechsel: Januar minus 3 Monate → Oktober des Vorjahres', () => {
    const { gpsBefore } = retentionCutoffs(new Date(2026, 0, 15), 24, 3);
    expect(gpsBefore).toEqual(new Date(2025, 9, 1));
  });
});

describe('runRetentionCleanup', () => {
  let userId: number;

  beforeAll(async () => {
    await sequelize.sync({ force: true });
    const user = await User.create({
      email: 'retention@timefeed.de',
      password: 'Test1234!',
      firstName: 'Retention',
      lastName: 'Test',
      role: UserRole.MITARBEITER,
      isActive: true,
      startDate: new Date('2020-01-01'),
    } as any);
    userId = user.id;
  });

  afterAll(async () => {
    await sequelize.close();
  });

  it('nullt GPS alter Einträge, löscht ganze Monate und lässt junge Daten unberührt', async () => {
    // Alt (vor 2024-07-01) → wird gelöscht.
    const oldEntry = await TimeEntry.create({
      userId, type: 'in', timestamp: new Date(2024, 4, 15, 8, 0), source: 'web',
      lat: 52.5, lng: 13.4, accuracy: 10,
    });
    // Mittel (nach Entries-Grenze, vor GPS-Grenze 2026-04-01) → bleibt, GPS wird genullt.
    const midEntry = await TimeEntry.create({
      userId, type: 'in', timestamp: new Date(2025, 0, 10, 8, 0), source: 'web',
      lat: 48.1, lng: 11.6, accuracy: 5,
    });
    // Jung (nach GPS-Grenze) → bleibt komplett inkl. GPS.
    const youngEntry = await TimeEntry.create({
      userId, type: 'in', timestamp: new Date(2026, 5, 20, 8, 0), source: 'web',
      lat: 50.9, lng: 6.9, accuracy: 8,
    });

    await WorkDay.create({ userId, date: '2024-05-15' }); // alt → weg
    await WorkDay.create({ userId, date: '2025-01-10' }); // jung genug → bleibt

    await CorrectionRequest.create({ userId, date: '2024-05-15', message: 'alt entschieden', proposedEntries: [], status: 'approved' });
    await CorrectionRequest.create({ userId, date: '2024-05-15', message: 'alt offen', proposedEntries: [], status: 'pending' });
    await CorrectionRequest.create({ userId, date: '2025-01-10', message: 'jung entschieden', proposedEntries: [], status: 'approved' });

    const result = await runRetentionCleanup(NOW);

    expect(result.entriesDeleted).toBe(1);
    expect(result.gpsCleared).toBe(1); // nur midEntry — oldEntry wird vorher gelöscht und nicht mitgezählt
    expect(result.workDaysDeleted).toBe(1);
    expect(result.correctionsDeleted).toBe(1);

    // Alt gelöscht, mittel/jung vorhanden.
    expect(await TimeEntry.findByPk(oldEntry.id)).toBeNull();
    const mid = await TimeEntry.findByPk(midEntry.id);
    expect(mid).not.toBeNull();
    expect(mid!.lat).toBeNull();
    expect(mid!.lng).toBeNull();
    expect(mid!.accuracy).toBeNull();
    const young = await TimeEntry.findByPk(youngEntry.id);
    expect(young!.lat).toBeCloseTo(50.9);
    expect(young!.accuracy).toBe(8);

    // WorkDays: nur der junge bleibt.
    const workDays = await WorkDay.findAll({ where: { userId } });
    expect(workDays.map((w) => w.date)).toEqual(['2025-01-10']);

    // CorrectionRequests: alter entschiedener weg, alter offener + junger bleiben.
    const corrections = await CorrectionRequest.findAll({ where: { userId }, order: [['id', 'ASC']] });
    expect(corrections.map((c) => c.message)).toEqual(['alt offen', 'jung entschieden']);

    // Audit-Log mit Anzahl geschrieben.
    const audit = await AuditLog.findOne({ where: { entity: 'Retention' }, order: [['id', 'DESC']] });
    expect(audit).not.toBeNull();
    const data = JSON.parse(audit!.additionalData || '{}');
    expect(data.entriesDeleted).toBe(1);
    expect(data.workDaysDeleted).toBe(1);
    expect(data.correctionsDeleted).toBe(1);
    expect(data.entriesCutoff).toBe('2024-07-01');
  });

  it('zweiter Lauf ist idempotent (nichts mehr zu tun, kein weiterer Audit-Eintrag)', async () => {
    const auditCountBefore = await AuditLog.count({ where: { entity: 'Retention' } });
    const result = await runRetentionCleanup(NOW);
    expect(result).toEqual({ gpsCleared: 0, entriesDeleted: 0, workDaysDeleted: 0, correctionsDeleted: 0 });
    expect(await AuditLog.count({ where: { entity: 'Retention' } })).toBe(auditCountBefore);
  });
});
