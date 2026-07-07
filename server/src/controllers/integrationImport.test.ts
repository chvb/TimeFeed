import { sequelize } from '../db/database';
import { Company, EmailSettings, IntegrationSettings, PasswordResetToken, Tenant, User } from '../models';
import { UserRole } from '../models/User';
import { IntegrationController } from './integration.controller';
import emailService from '../services/emailService';

// axios wird komplett gestubbt: die "UrlaubsFeed-Gegenstelle" antwortet aus dem Test.
jest.mock('axios');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const axios = require('axios');

/**
 * Mitarbeiter-Abgleich UrlaubsFeed → TimeFeed (integration.controller):
 * - GET  /api/integrations/urlaubsfeed/users     → Vorschau mit Status new/exists/diff
 * - POST /api/integrations/urlaubsfeed/import-users → selektiver Import
 * Kernlogik (Anlegen/Update/Welcome-Gate) mit gestubbtem axios; kein HTTP-Server nötig.
 */

jest.setTimeout(60000);

const controller = new IntegrationController();

function mockRes() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}

type Actor = { id: number; email: string; role: UserRole; companyId: number | null; tenantId: number | null; isSuperAdmin: boolean };

async function call(fn: (req: any, res: any, next: any) => any, opts: { user: Actor; body?: any; query?: any }) {
  const req: any = {
    user: opts.user,
    body: opts.body || {},
    query: opts.query || {},
    params: {},
    headers: {},
    ip: '127.0.0.1',
    connection: { remoteAddress: '127.0.0.1' },
    get: () => undefined,
  };
  const res = mockRes();
  let err: any = null;
  await fn(req, res, (e: any) => { err = e; });
  return { res, err };
}

const remoteOk = (users: any[]) => {
  (axios.get as jest.Mock).mockResolvedValue({ status: 200, data: { users } });
};

let tenant: Tenant;
let company: Company;
let admin: User;
let actor: Actor;

// Remote-Stammdaten der "UrlaubsFeed-Instanz".
const REMOTE = [
  { firstName: 'Nina', lastName: 'Neu', email: 'nina.neu@test.de', employeeNumber: 'P-100', groupName: 'Team A', isActive: true, role: 'mitarbeiter' },
  { firstName: 'Max', lastName: 'Match', email: 'Max.Match@test.de', employeeNumber: null, groupName: null, isActive: true, role: 'mitarbeiter' },
  { firstName: 'Dora', lastName: 'Anders', email: 'dora.alt@test.de', employeeNumber: 'P-777', groupName: 'Team B', isActive: true, role: 'admin' },
];

beforeAll(async () => {
  await sequelize.sync({ force: true });
  tenant = await Tenant.create({ name: 'Import-Mandant', isActive: true } as any);
  company = await Company.create({ name: 'Import GmbH', isActive: true, tenantId: tenant.id } as any);
  admin = await User.create({
    email: 'admin@import.test', password: 'Test1234!', firstName: 'Ada', lastName: 'Admin',
    role: UserRole.ADMIN, companyId: company.id, isActive: true, startDate: new Date('2025-01-01'),
  });
  actor = { id: admin.id, email: admin.email, role: UserRole.ADMIN, companyId: company.id, tenantId: null, isSuperAdmin: false };
  await IntegrationSettings.create({
    tenantId: tenant.id, urlaubsfeedUrl: 'https://urlaub.example.com', urlaubsfeedApiKey: 'ufk_test', syncEnabled: false,
  } as any);
  // Lokal vorhandene Nutzer: Max (identisch) und Dora (Name/Personalnr. weichen ab).
  await User.create({
    email: 'max.match@test.de', password: 'Test1234!', firstName: 'Max', lastName: 'Match',
    role: UserRole.MITARBEITER, companyId: company.id, isActive: true, startDate: new Date('2025-01-01'),
  });
  await User.create({
    email: 'dora.alt@test.de', password: 'Test1234!', firstName: 'Dora', lastName: 'Alt', employeeNumber: 'P-001',
    role: UserRole.MITARBEITER, companyId: company.id, isActive: true, startDate: new Date('2025-01-01'),
  });
});

afterAll(async () => {
  await sequelize.close();
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /integrations/urlaubsfeed/users (Vorschau)', () => {
  it('matcht per E-Mail (case-insensitive) und liefert new/exists/diff inkl. diff-Feldern', async () => {
    remoteOk(REMOTE);
    const { res, err } = await call(controller.listRemoteUsers, { user: actor });
    expect(err).toBeNull();
    expect(res.statusCode).toBe(200);
    const byEmail = new Map(res.body.users.map((u: any) => [u.email.toLowerCase(), u]));
    expect((byEmail.get('nina.neu@test.de') as any).status).toBe('new');
    expect((byEmail.get('max.match@test.de') as any).status).toBe('exists');
    const dora: any = byEmail.get('dora.alt@test.de');
    expect(dora.status).toBe('diff');
    expect(dora.diff).toEqual({ lastName: 'Anders', employeeNumber: 'P-777' });
    // Keine Geheimnisse in der Vorschau
    expect(Object.keys(byEmail.get('nina.neu@test.de') as any)).not.toEqual(expect.arrayContaining(['password', 'pin', 'stampCode']));
  });

  it('meldet eine tote/fehlerhafte Gegenstelle als 502 mit Message', async () => {
    (axios.get as jest.Mock).mockRejectedValue(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    const { err } = await call(controller.listRemoteUsers, { user: actor });
    expect(err).not.toBeNull();
    expect(err.statusCode).toBe(502);
    expect(String(err.message)).toContain('ECONNREFUSED');
  });
});

describe('POST /integrations/urlaubsfeed/import-users', () => {
  it('legt NUR die gewählten neuen Nutzer an (Rolle mitarbeiter, stampCode, gehashtes Zufallspasswort)', async () => {
    remoteOk(REMOTE);
    const { res, err } = await call(controller.importUsers, {
      user: actor,
      body: { emails: ['nina.neu@test.de'], updateExisting: false, sendWelcome: false },
    });
    expect(err).toBeNull();
    expect(res.body).toMatchObject({ created: 1, updated: 0, skipped: 0, errors: [] });

    const nina = await User.findOne({ where: { email: 'nina.neu@test.de' } });
    expect(nina).not.toBeNull();
    expect(nina!.role).toBe(UserRole.MITARBEITER);
    expect(nina!.companyId).toBe(company.id);
    expect(nina!.employeeNumber).toBe('P-100');
    expect(nina!.stampCode).toMatch(/^\d{8}$/); // automatisch per Hook vergeben
    expect(nina!.password.startsWith('$2')).toBe(true); // bcrypt-Hash, kein Klartext
    // Nicht gewählte Remote-Nutzer bleiben unangetastet: Dora unverändert.
    const dora = await User.findOne({ where: { email: 'dora.alt@test.de' } });
    expect(dora!.lastName).toBe('Alt');
  });

  it('überspringt Vorhandene ohne updateExisting und aktualisiert mit updateExisting nur Name/Personalnr.', async () => {
    remoteOk(REMOTE);
    const doraBefore = await User.findOne({ where: { email: 'dora.alt@test.de' } });
    const passwordBefore = doraBefore!.password;

    let r = await call(controller.importUsers, {
      user: actor,
      body: { emails: ['dora.alt@test.de'], updateExisting: false, sendWelcome: false },
    });
    expect(r.res.body).toMatchObject({ created: 0, updated: 0, skipped: 1 });

    r = await call(controller.importUsers, {
      user: actor,
      body: { emails: ['dora.alt@test.de', 'max.match@test.de'], updateExisting: true, sendWelcome: false },
    });
    // Dora hat Abweichungen → updated; Max ist identisch → skipped.
    expect(r.res.body).toMatchObject({ created: 0, updated: 1, skipped: 1, errors: [] });

    const dora = await User.findOne({ where: { email: 'dora.alt@test.de' } });
    expect(dora!.lastName).toBe('Anders');
    expect(dora!.employeeNumber).toBe('P-777');
    // E-Mail/Rolle/Passwort werden NIE angefasst (Remote-Rolle 'admin' wird ignoriert).
    expect(dora!.email).toBe('dora.alt@test.de');
    expect(dora!.role).toBe(UserRole.MITARBEITER);
    expect(dora!.password).toBe(passwordBefore);
  });

  it('meldet unbekannte E-Mails als Fehler statt zu crashen', async () => {
    remoteOk(REMOTE);
    const { res } = await call(controller.importUsers, {
      user: actor,
      body: { emails: ['gibtsnicht@test.de'], updateExisting: false, sendWelcome: false },
    });
    expect(res.body.created).toBe(0);
    expect(res.body.errors).toEqual([{ email: 'gibtsnicht@test.de', reason: expect.stringContaining('nicht gefunden') }]);
  });

  it('Welcome-Gate: ohne aktives SMTP wird KEINE Mail versendet und kein Token erzeugt', async () => {
    remoteOk([...REMOTE, { firstName: 'Willi', lastName: 'Welcome', email: 'willi@test.de', employeeNumber: null, groupName: null }]);
    const sendSpy = jest.spyOn(emailService, 'sendWelcome').mockResolvedValue(true as any);

    const { res } = await call(controller.importUsers, {
      user: actor,
      body: { emails: ['willi@test.de'], updateExisting: false, sendWelcome: true },
    });
    expect(res.body.created).toBe(1);
    expect(sendSpy).not.toHaveBeenCalled(); // kein SMTP konfiguriert → still übersprungen
    const willi = await User.findOne({ where: { email: 'willi@test.de' } });
    expect(await PasswordResetToken.count({ where: { userId: willi!.id } })).toBe(0);
    sendSpy.mockRestore();
  });

  it('Welcome-Gate: mit aktivem SMTP wird Token erzeugt + Mail versendet; Mail-Fehler werden geschluckt', async () => {
    await EmailSettings.create({ smtpHost: 'smtp.test', fromEmail: 'noreply@test.de', fromName: 'TimeFeed', isActive: true } as any);
    remoteOk([
      { firstName: 'Wanda', lastName: 'Welcome', email: 'wanda@test.de', employeeNumber: null, groupName: null },
      { firstName: 'Fiona', lastName: 'Fail', email: 'fiona@test.de', employeeNumber: null, groupName: null },
    ]);
    const sendSpy = jest.spyOn(emailService, 'sendWelcome')
      .mockResolvedValueOnce(true as any)
      .mockRejectedValueOnce(new Error('SMTP down'));

    const { res, err } = await call(controller.importUsers, {
      user: actor,
      body: { emails: ['wanda@test.de', 'fiona@test.de'], updateExisting: false, sendWelcome: true },
    });
    expect(err).toBeNull();
    // Mail-Fehler bei Fiona wird geschluckt: beide Nutzer gelten als angelegt.
    expect(res.body).toMatchObject({ created: 2, errors: [] });
    expect(sendSpy).toHaveBeenCalledTimes(2);

    const wanda = await User.findOne({ where: { email: 'wanda@test.de' } });
    expect(await PasswordResetToken.count({ where: { userId: wanda!.id } })).toBe(1);
    expect(sendSpy.mock.calls[0][0]).toBe('wanda@test.de');
    expect(typeof sendSpy.mock.calls[0][2]).toBe('string'); // Reset-Token für den „Passwort festlegen"-Link
    sendSpy.mockRestore();
    await EmailSettings.destroy({ where: {} });
  });
});
