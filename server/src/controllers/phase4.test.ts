import { sequelize } from '../db/database';
import { Company, CorrectionRequest, MonthClosure, TimeEntry, User, WorkDay } from '../models';
import { UserRole } from '../models/User';
import { SettingsController } from './settings.controller';
import { TimeController } from './time.controller';
import { CorrectionController } from './correction.controller';
import { ymdLocal } from '../services/timeCalcService';
import { monthEndDate } from '../services/monthLockService';

/**
 * Phase-4-Tests (Verwaltung & Buchhaltung): Monatsabschluss sperrt Nachbuchungen,
 * incomplete-Tage verhindern den Abschluss, Wiedereröffnung macht änderbar,
 * Genehmigung eines Korrekturantrags wendet proposedEntries an (inkl. Recalc).
 *
 * Controller werden direkt mit Mock-req/res aufgerufen (kein HTTP-Server nötig).
 */

jest.setTimeout(60000);

const timeController = new TimeController();
const correctionController = new CorrectionController();

// Fester Testtag: 15. des VORMONATS (immer in der Vergangenheit, Monat komplett
// abschließbar, weit unter der 92-Tage-Grenze für Nachbuchungen).
const now = new Date();
const prev15 = new Date(now.getFullYear(), now.getMonth() - 1, 15, 12, 0, 0);
const DAY = ymdLocal(prev15);
const MONTH = DAY.slice(0, 7);

const at = (date: string, h: number, m = 0): Date => {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(y, mo - 1, d, h, m, 0, 0);
};

function mockRes() {
  const r: any = { statusCode: 200, body: undefined, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.end = (b: any) => { r.body = b; return r; };
  return r;
}

type Actor = { id: number; email: string; role: UserRole; companyId: number | null; tenantId: number | null; isSuperAdmin: boolean };

const actorOf = (u: User): Actor => ({
  id: u.id, email: u.email, role: u.role,
  companyId: u.companyId ?? null, tenantId: u.tenantId ?? null, isSuperAdmin: !!u.isSuperAdmin,
});

async function call(fn: (req: any, res: any, next: any) => any, opts: { user: Actor; body?: any; query?: any; params?: any }) {
  const req: any = {
    user: opts.user,
    body: opts.body || {},
    query: opts.query || {},
    params: opts.params || {},
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    get: () => undefined,
  };
  const res = mockRes();
  let err: any = null;
  await fn(req, res, (e: any) => { err = e; });
  return { res, err };
}

let userSeq = 0;
async function createUser(companyId: number, role: UserRole, overrides: any = {}): Promise<User> {
  userSeq += 1;
  return User.create({
    email: `phase4-${userSeq}@timefeed.de`,
    password: 'Test1234!',
    firstName: 'P4',
    lastName: `User${userSeq}`,
    role,
    companyId,
    isActive: true,
    startDate: new Date('2025-01-01'),
    ...overrides,
  });
}

async function stamp(userId: number, companyId: number, type: 'in' | 'out' | 'break_start' | 'break_end', ts: Date) {
  return TimeEntry.create({ userId, companyId, type, timestamp: ts, source: 'web', lat: 52.5, lng: 13.4 });
}

beforeAll(async () => {
  await sequelize.sync({ force: true });
  await new SettingsController().getOrCreateSettings(null); // globale Default-Settings (breakMode 'auto')
});

afterAll(async () => {
  await sequelize.close();
});

describe('Monatsabschluss (close/reopen)', () => {
  let company: Company;
  let admin: User;
  let employee: User;

  beforeAll(async () => {
    company = await Company.create({ name: 'Phase4 Abschluss GmbH', isActive: true });
    admin = await createUser(company.id, UserRole.ADMIN);
    employee = await createUser(company.id, UserRole.MITARBEITER);
    // Vollständiger Tag: 08–16 Uhr → 480 brutto − 30 Auto-Pause = 450 Minuten.
    await stamp(employee.id, company.id, 'in', at(DAY, 8));
    await stamp(employee.id, company.id, 'out', at(DAY, 16));
  });

  it('schließt den Monat ab (WorkDays locked, totals-Snapshot)', async () => {
    const { res, err } = await call(timeController.closeMonth.bind(timeController), {
      user: actorOf(admin), body: { month: MONTH },
    });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(201);
    expect(res.body.closure).toBeDefined();
    expect(res.body.closure.month).toBe(MONTH);
    expect(res.body.closure.userId).toBeNull();
    const totals = res.body.closure.totals;
    const empRow = totals.users.find((u: any) => u.userId === employee.id);
    expect(empRow.workedMinutes).toBe(450);

    const wd = await WorkDay.findOne({ where: { userId: employee.id, date: DAY } });
    expect(wd!.status).toBe('locked');
  });

  it('sperrt Nachbuchungen in den abgeschlossenen Monat (manual → 423 MONTH_LOCKED)', async () => {
    const { res } = await call(timeController.manual.bind(timeController), {
      user: actorOf(admin),
      body: { userId: employee.id, type: 'out', timestamp: at(DAY, 17).toISOString() },
    });
    expect(res.statusCode).toBe(423);
    expect(res.body.code).toBe('MONTH_LOCKED');
  });

  it('sperrt auch Storno im abgeschlossenen Monat (423)', async () => {
    const entry = await TimeEntry.findOne({ where: { userId: employee.id, type: 'in' } });
    const { res } = await call(timeController.cancelEntry.bind(timeController), {
      user: actorOf(admin), params: { id: String(entry!.id) }, body: { reason: 'Test' },
    });
    expect(res.statusCode).toBe(423);
    expect(res.body.code).toBe('MONTH_LOCKED');
  });

  it('verweigert doppelten Abschluss (409 ALREADY_CLOSED)', async () => {
    const { res } = await call(timeController.closeMonth.bind(timeController), {
      user: actorOf(admin), body: { month: MONTH },
    });
    expect(res.statusCode).toBe(409);
    expect(res.body.code).toBe('ALREADY_CLOSED');
  });

  it('reopen (nur admin) macht den Monat wieder änderbar, Recalc stimmt', async () => {
    const { res, err } = await call(timeController.reopenMonth.bind(timeController), {
      user: actorOf(admin), body: { month: MONTH },
    });
    expect(err).toBeNull();
    expect(res.body.reopened).toBe(true);
    expect(await MonthClosure.count({ where: { companyId: company.id, month: MONTH } })).toBe(0);

    const wd = await WorkDay.findOne({ where: { userId: employee.id, date: DAY } });
    expect(wd!.status).not.toBe('locked');

    // Nachbuchung funktioniert jetzt: zweite Schicht 17–18 Uhr → 540 brutto − 30 = 510.
    const r1 = await call(timeController.manual.bind(timeController), {
      user: actorOf(admin),
      body: { userId: employee.id, type: 'in', timestamp: at(DAY, 17).toISOString(), note: 'Nachbuchung' },
    });
    expect(r1.res.statusCode).toBe(201);
    expect(r1.res.body.entry.source).toBe('manual');
    expect(r1.res.body.entry.createdById).toBe(admin.id);

    const r2 = await call(timeController.manual.bind(timeController), {
      user: actorOf(admin),
      body: { userId: employee.id, type: 'out', timestamp: at(DAY, 18).toISOString() },
    });
    expect(r2.res.statusCode).toBe(201);
    expect(r2.res.body.workDay.workedMinutes).toBe(510);
  });

  it('monthEndDate liefert den letzten Kalendertag (kein pauschales -31)', () => {
    expect(monthEndDate('2026-06')).toBe('2026-06-30');
    expect(monthEndDate('2026-02')).toBe('2026-02-28');
    expect(monthEndDate('2028-02')).toBe('2028-02-29');
    expect(monthEndDate('2026-07')).toBe('2026-07-31');
  });

  it('month-overview zählt NUR Tage des Monats (Regression: DATEONLY-Range)', async () => {
    // WorkDay im FOLGEMONAT darf die Summen des Zielmonats nicht verfälschen.
    const nextMonthDay = ymdLocal(new Date(prev15.getFullYear(), prev15.getMonth() + 1, 1));
    await WorkDay.create({
      userId: employee.id, companyId: company.id, date: nextMonthDay,
      targetMinutes: 480, workedMinutes: 999, balanceMinutes: 519, status: 'ok', flags: [],
    } as any);

    const { res } = await call(timeController.monthOverview.bind(timeController), {
      user: actorOf(admin), query: { month: MONTH },
    });
    const row = res.body.users.find((u: any) => u.userId === employee.id);
    // Stand nach reopen-Test: 08–16 + 17–18 Uhr = 510 Minuten im Zielmonat.
    expect(row.workedMinutes).toBe(510);
    await WorkDay.destroy({ where: { userId: employee.id, date: nextMonthDay } });
  });

  it('Storno funktioniert nach reopen und rechnet neu', async () => {
    const entry = await TimeEntry.findOne({
      where: { userId: employee.id, type: 'out', source: 'manual' },
      order: [['id', 'DESC']],
    });
    const { res, err } = await call(timeController.cancelEntry.bind(timeController), {
      user: actorOf(admin), params: { id: String(entry!.id) }, body: { reason: 'Falsch gebucht' },
    });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(200);
    expect(res.body.entry.isCancelled).toBe(true);
    // 17-Uhr-'in' bleibt ohne 'out' → Tag wird incomplete, Ist-Zeit der offenen
    // Schicht zählt nicht: nur die geschlossene 08–16-Schicht (450).
    expect(res.body.workDay.status).toBe('incomplete');
    expect(res.body.workDay.workedMinutes).toBe(450);
  });
});

describe('close-month verweigert incomplete-Tage', () => {
  it('liefert 400 INCOMPLETE_DAYS mit Tagesliste', async () => {
    const company = await Company.create({ name: 'Phase4 Incomplete GmbH', isActive: true });
    const admin = await createUser(company.id, UserRole.ADMIN);
    const employee = await createUser(company.id, UserRole.MITARBEITER);
    await stamp(employee.id, company.id, 'in', at(DAY, 9)); // Ausstempeln vergessen

    const { res } = await call(timeController.closeMonth.bind(timeController), {
      user: actorOf(admin), body: { month: MONTH },
    });
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe('INCOMPLETE_DAYS');
    expect(res.body.days).toEqual(expect.arrayContaining([{ userId: employee.id, date: DAY }]));
    expect(await MonthClosure.count({ where: { companyId: company.id } })).toBe(0);
  });
});

describe('Korrekturanträge', () => {
  let company: Company;
  let admin: User;
  let employee: User;

  beforeAll(async () => {
    company = await Company.create({ name: 'Phase4 Korrektur GmbH', isActive: true });
    admin = await createUser(company.id, UserRole.ADMIN);
    employee = await createUser(company.id, UserRole.MITARBEITER);
  });

  it('Mitarbeiter erstellt Antrag; approve wendet proposedEntries an + Recalc stimmt', async () => {
    const created = await call(correctionController.create.bind(correctionController), {
      user: actorOf(employee),
      body: {
        date: DAY,
        message: 'Stempeln vergessen',
        proposedEntries: [
          { type: 'in', time: '08:00' },
          { type: 'out', time: '16:30' },
        ],
      },
    });
    expect(created.err).toBeNull();
    expect(created.res.statusCode).toBe(201);
    const correctionId = created.res.body.correction.id;
    expect(created.res.body.correction.status).toBe('pending');

    const approved = await call(correctionController.approve.bind(correctionController), {
      user: actorOf(admin), params: { id: String(correctionId) }, body: { note: 'passt' },
    });
    expect(approved.err).toBeNull();
    expect(approved.res.statusCode).toBe(200);
    expect(approved.res.body.correction.status).toBe('approved');
    expect(approved.res.body.correction.decidedById).toBe(admin.id);

    // proposedEntries wurden als manual-Einträge angewendet (createdById = Genehmiger).
    const entries = await TimeEntry.findAll({ where: { userId: employee.id, source: 'manual' } });
    expect(entries).toHaveLength(2);
    for (const e of entries) expect(e.createdById).toBe(admin.id);

    // Recalc: 08:00–16:30 = 510 brutto − 30 Auto-Pause = 480 Minuten.
    const wd = approved.res.body.workDay;
    expect(wd.workedMinutes).toBe(480);
    expect(wd.autoBreakMinutes).toBe(30);
    const dbWd = await WorkDay.findOne({ where: { userId: employee.id, date: DAY } });
    expect(dbWd!.workedMinutes).toBe(480);
  });

  it('reject setzt Status und verlangt eine Begründung', async () => {
    const created = await call(correctionController.create.bind(correctionController), {
      user: actorOf(employee),
      body: { date: DAY, message: 'Noch eine Korrektur', proposedEntries: [{ type: 'in', time: '07:00' }] },
    });
    const id = created.res.body.correction.id;

    const noNote = await call(correctionController.reject.bind(correctionController), {
      user: actorOf(admin), params: { id: String(id) }, body: {},
    });
    expect(noNote.err?.statusCode).toBe(400);

    const rejected = await call(correctionController.reject.bind(correctionController), {
      user: actorOf(admin), params: { id: String(id) }, body: { note: 'Bitte Nachweis' },
    });
    expect(rejected.err).toBeNull();
    expect(rejected.res.body.correction.status).toBe('rejected');
    expect((await CorrectionRequest.findByPk(id))!.status).toBe('rejected');
  });

  it('Antrag für gesperrten Tag → 423', async () => {
    const { res: closeRes } = await call(timeController.closeMonth.bind(timeController), {
      user: actorOf(admin), body: { month: MONTH, userId: employee.id },
    });
    expect(closeRes.statusCode).toBe(201);
    expect(closeRes.body.closure.userId).toBe(employee.id);

    const { res } = await call(correctionController.create.bind(correctionController), {
      user: actorOf(employee),
      body: { date: DAY, message: 'Zu spät', proposedEntries: [{ type: 'in', time: '08:00' }] },
    });
    expect(res.statusCode).toBe(423);
    expect(res.body.code).toBe('MONTH_LOCKED');
  });
});
