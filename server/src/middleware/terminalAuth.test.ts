import { sequelize } from '../db/database';
import { Company, TerminalDevice } from '../models';
import { generateTerminalToken, hashTerminalToken } from '../models/TerminalDevice';
import { terminalAuth } from './terminalAuth';

/** Unit-Tests der Geräte-Auth (X-Terminal-Token → SHA-256-Lookup). */

const mockReq = (token?: string): any => ({
  header: (name: string) => (name.toLowerCase() === 'x-terminal-token' ? token : undefined),
});

const mockRes = (): any => {
  const res: any = { statusCode: null, body: null };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res; });
  res.json = jest.fn((body: any) => { res.body = body; return res; });
  return res;
};

let company: Company;

beforeAll(async () => {
  await sequelize.sync({ force: true });
  company = await Company.create({ name: 'Terminal-Test GmbH', isActive: true });
});

afterAll(async () => {
  await sequelize.close();
});

async function createTerminal(overrides: Partial<Parameters<typeof TerminalDevice.create>[0]> = {}) {
  const token = generateTerminalToken();
  const terminal = await TerminalDevice.create({
    companyId: company.id,
    name: `Terminal ${Math.random().toString(36).slice(2, 8)}`,
    tokenHash: hashTerminalToken(token),
    tokenPrefix: token.slice(0, 8),
    ...(overrides as any),
  });
  return { token, terminal };
}

describe('terminalAuth', () => {
  it('gültiges Token → req.terminal gesetzt, next() aufgerufen, lastSeenAt aktualisiert', async () => {
    const { token, terminal } = await createTerminal();
    expect(terminal.lastSeenAt).toBeFalsy();

    const req = mockReq(token);
    const res = mockRes();
    const next = jest.fn();
    await terminalAuth(req, res, next);

    expect(next).toHaveBeenCalledWith(); // ohne Fehler
    expect(res.status).not.toHaveBeenCalled();
    expect(req.terminal).toBeDefined();
    expect(req.terminal.id).toBe(terminal.id);
    expect(req.terminal.lastSeenAt).toBeTruthy();
  });

  it('lastSeenAt wird gedrosselt (kein Update innerhalb der Throttle-Spanne)', async () => {
    const { token } = await createTerminal();

    const first = mockReq(token);
    await terminalAuth(first, mockRes(), jest.fn());
    const firstSeen = new Date(first.terminal.lastSeenAt).getTime();

    const second = mockReq(token);
    await terminalAuth(second, mockRes(), jest.fn());
    expect(new Date(second.terminal.lastSeenAt).getTime()).toBe(firstSeen);
  });

  it('fehlender Header → 401 TERMINAL_TOKEN_REQUIRED', async () => {
    const res = mockRes();
    const next = jest.fn();
    await terminalAuth(mockReq(undefined), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TERMINAL_TOKEN_REQUIRED');
  });

  it('ungültiges Token → 401 TERMINAL_TOKEN_INVALID', async () => {
    await createTerminal();
    const res = mockRes();
    const next = jest.fn();
    await terminalAuth(mockReq('tft_definitiv_falsch_0000000000000000000000000000'), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TERMINAL_TOKEN_INVALID');
  });

  it('inaktives Terminal → 401 TERMINAL_TOKEN_INVALID (gleiche Antwort wie unbekannt)', async () => {
    const { token } = await createTerminal({ isActive: false });
    const res = mockRes();
    const next = jest.fn();
    await terminalAuth(mockReq(token), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe('TERMINAL_TOKEN_INVALID');
  });
});
