// @ts-check
// NFC-Anbindung (FeedAuth-Hub), App-Seite: link-API (Scope link:write), Handoff-Exchange
// → kurzlebige Stempel-Sitzung, Scope-Isolation, PIN-Pflicht-Meldung. Der Test signiert
// die Handoffs selbst mit dem e2e-Handoff-Secret und spielt so die Rolle des Hubs.
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');
const { HANDOFF_SECRET, SERVER_DIR } = require('../lib/env');
const jwt = require(SERVER_DIR + '/node_modules/jsonwebtoken');

function mintHandoff(pid, act = 'stamp') {
  return jwt.sign({ pid, act, jti: 'e2e-' + Math.random().toString(36).slice(2) }, HANDOFF_SECRET, {
    expiresIn: 120, issuer: 'feedauth',
  });
}

async function linkKey(request) {
  const admin = await login(request, 'admin');
  const tenants = (await (await request.get('/api/tenants', { headers: admin.headers })).json()).tenants;
  const res = await request.post('/api/api-keys', {
    headers: admin.headers,
    data: { name: `E2E NFC ${Date.now()}`, tenantId: tenants[0].id, scopes: ['link:write'] },
  });
  expect(res.status()).toBe(201);
  const body = await res.json();
  expect(body.apiKey.scopes).toContain('link:write');
  return { admin, key: body.key };
}

async function makeUser(request, admin) {
  const email = `nfc-${Date.now()}-${Math.floor(Math.random() * 1e4)}@timefeed.de`;
  const res = await request.post('/api/users', {
    headers: admin.headers,
    data: { email, password: 'NfcTest_Pass123!', firstName: 'Nfc', lastName: 'User', role: 'mitarbeiter', companyId: admin.user.companyId },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).user.id;
}

test.describe('NFC-Anbindung (App-Seite)', () => {
  test('link-API: Nutzerliste, Zuordnen von hubPersonId, pin-required', async ({ request }) => {
    const { admin, key } = await linkKey(request);
    const H = { 'X-Api-Key': key };
    const userId = await makeUser(request, admin);

    // Ohne Scope link:write → 403 (Default-Key hat ihn nicht).
    const plain = await request.post('/api/api-keys', { headers: admin.headers, data: { name: `plain ${Date.now()}`, tenantId: admin.user.tenantId || undefined } });
    const plainKey = (await plain.json()).key;
    expect((await request.get('/api/external/link/users', { headers: { 'X-Api-Key': plainKey } })).status()).toBe(403);

    // Nutzerliste enthält den neuen Nutzer, ohne hubPersonId.
    const list = await (await request.get('/api/external/link/users', { headers: H })).json();
    const u = list.users.find((x) => x.id === userId);
    expect(u).toBeTruthy();
    expect(u.hubPersonId).toBeNull();

    // Zuordnen + Gegencheck.
    const pid = 'p_e2e_' + userId;
    const assign = await request.post('/api/external/link/assign', { headers: H, data: { userId, hubPersonId: pid } });
    expect(assign.ok()).toBeTruthy();
    const list2 = await (await request.get('/api/external/link/users', { headers: H })).json();
    expect(list2.users.find((x) => x.id === userId).hubPersonId).toBe(pid);

    // pin-required: Standard false.
    const pr = await (await request.get(`/api/external/link/pin-required?userId=${userId}`, { headers: H })).json();
    expect(pr.pinRequired).toBe(false);
  });

  test('Handoff-Exchange → Stempel-Sitzung: status + stamp; Scope-Isolation', async ({ request }) => {
    const { admin, key } = await linkKey(request);
    const H = { 'X-Api-Key': key };
    const userId = await makeUser(request, admin);
    const pid = 'p_e2e_ex_' + userId;
    await request.post('/api/external/link/assign', { headers: H, data: { userId, hubPersonId: pid } });

    // Exchange mit gültigem Handoff.
    const exch = await request.post('/api/nfc/exchange', { data: { handoff: mintHandoff(pid) } });
    expect(exch.status()).toBe(200);
    const { token, user } = await exch.json();
    expect(user.firstName).toBe('Nfc');
    const SH = { Authorization: `Bearer ${token}` };

    // Status + erfolgreicher Stempel (gpsMode default optional → ohne GPS ok).
    expect((await request.get('/api/nfc/status', { headers: SH })).status()).toBe(200);
    const stamp = await request.post('/api/nfc/stamp', { headers: SH, data: { type: 'in' } });
    expect(stamp.status()).toBe(201);
    expect((await stamp.json()).state).toBe('in');

    // Scope-Isolation: die Stempel-Sitzung ist keine vollwertige Anmeldung.
    expect((await request.get('/api/auth/me', { headers: SH })).status()).toBe(401);
    expect((await request.get('/api/users', { headers: SH })).status()).toBe(401);
  });

  test('Exchange: ungültiger/falscher/unbekannter Handoff', async ({ request }) => {
    // Ungültige Signatur.
    const bad = jwt.sign({ pid: 'x', act: 'stamp', jti: '1' }, 'falsch', { expiresIn: 120, issuer: 'feedauth' });
    expect((await request.post('/api/nfc/exchange', { data: { handoff: bad } })).status()).toBe(401);

    // Falsche Aktion (leave statt stamp).
    const wrongAct = await request.post('/api/nfc/exchange', { data: { handoff: mintHandoff('p_x', 'leave') } });
    expect(wrongAct.status()).toBe(400);

    // Unbekannte Person (kein Nutzer mit dieser hubPersonId).
    const unknown = await request.post('/api/nfc/exchange', { data: { handoff: mintHandoff('p_does_not_exist') } });
    expect(unknown.status()).toBe(404);
  });
});
