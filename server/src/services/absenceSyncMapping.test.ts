import { sequelize } from '../db/database';
import '../models'; // Assoziationen
import {
  AbsenceType,
  ABSENCE_COLOR_PALETTE,
  BUILTIN_ABSENCE_TYPES,
  seedBuiltinAbsenceTypes,
} from '../models/AbsenceType';
import { resolveAbsenceTypeKey } from './absenceSyncService';

/**
 * UrlaubsFeed-Sync-Mapping: leaveTypeKey → Abwesenheitsarten-Katalog.
 * - defensiv ohne leaveTypeKey (wie bisher type vacation/sick)
 * - vorhandener aktiver Key wird verwendet
 * - unbekannter Key → automatische AKTIVE Anlage (UrlaubsFeed ist führend)
 * - deaktivierte Art wird reaktiviert; 'sick' bleibt 'sick'.
 */

jest.setTimeout(60000);

beforeAll(async () => {
  await sequelize.sync({ force: true });
  await seedBuiltinAbsenceTypes();
});

afterAll(async () => {
  await sequelize.close();
});

describe('seedBuiltinAbsenceTypes', () => {
  it('legt alle eingebauten Arten als globale Vorlagen an (idempotent)', async () => {
    await seedBuiltinAbsenceTypes(); // zweiter Lauf darf nichts duplizieren
    const all = await AbsenceType.findAll({ where: { companyId: null, isBuiltin: true } });
    expect(all).toHaveLength(BUILTIN_ABSENCE_TYPES.length);
    const vacation = all.find((t) => t.key === 'vacation');
    const sick = all.find((t) => t.key === 'sick');
    expect(vacation?.datevKennzeichen).toBe('U');
    expect(sick?.datevKennzeichen).toBe('K');
    expect(all.every((t) => t.isActive)).toBe(true);
  });
});

describe('resolveAbsenceTypeKey', () => {
  it('ohne leaveTypeKey: bisheriges Verhalten (type vacation/sick)', async () => {
    expect(await resolveAbsenceTypeKey(null, 'vacation')).toBe('vacation');
    expect(await resolveAbsenceTypeKey(undefined, 'sick')).toBe('sick');
    expect(await resolveAbsenceTypeKey('', 'somethingelse')).toBe('vacation');
  });

  it('sick bleibt sick', async () => {
    expect(await resolveAbsenceTypeKey('sick', 'sick')).toBe('sick');
  });

  it('existierender aktiver Katalog-Key wird direkt verwendet', async () => {
    expect(await resolveAbsenceTypeKey('doctor', 'vacation')).toBe('doctor');
    // keine Duplikate angelegt
    expect(await AbsenceType.count({ where: { key: 'doctor' } })).toBe(1);
  });

  it('unbekannter Key → automatische AKTIVE Anlage mit Label und Palettenfarbe', async () => {
    const key = await resolveAbsenceTypeKey('sabbatical', 'vacation', 'Sabbatical');
    expect(key).toBe('sabbatical');
    const created = await AbsenceType.findOne({ where: { key: 'sabbatical' } });
    expect(created).toBeTruthy();
    expect(created!.isActive).toBe(true);
    expect(created!.isBuiltin).toBe(false);
    expect(created!.label).toBe('Sabbatical');
    expect(created!.companyId).toBeNull();
    expect(ABSENCE_COLOR_PALETTE).toContain(created!.color);
    // Label-Fallback = key
    await resolveAbsenceTypeKey('overtime_comp', 'vacation', null);
    const second = await AbsenceType.findOne({ where: { key: 'overtime_comp' } });
    expect(second!.label).toBe('overtime_comp');
  });

  it('deaktivierte Art wird reaktiviert statt dupliziert', async () => {
    const t = await AbsenceType.findOne({ where: { key: 'training' } });
    await t!.update({ isActive: false });
    expect(await resolveAbsenceTypeKey('training', 'vacation')).toBe('training');
    await t!.reload();
    expect(t!.isActive).toBe(true);
    expect(await AbsenceType.count({ where: { key: 'training' } })).toBe(1);
  });

  it("ungültige Keys (Format/'holiday') fallen defensiv auf type zurück", async () => {
    expect(await resolveAbsenceTypeKey('holiday', 'vacation')).toBe('vacation');
    expect(await resolveAbsenceTypeKey('Sonder Urlaub!', 'sick')).toBe('sick');
  });

  it('Groß-/Kleinschreibung wird normalisiert', async () => {
    expect(await resolveAbsenceTypeKey('VACATION', 'vacation')).toBe('vacation');
  });
});
