// @ts-check
const { test, expect } = require('@playwright/test');
const { login, uniq, futureRange } = require('./helpers');

// Minimaler gültiger PDF-Inhalt für Anhang-Uploads.
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

// Mandanten-Isolation: Firmen-Admin sieht nur die eigene Firma.
test.describe('Mandanten / Unterfirmen', () => {
  test('Super-Admin legt Firmen an; Firmen-Admin sieht nur die eigene Firma', async ({ request }) => {
    const sa = await login(request, 'admin'); // e2e-admin = Super-Admin
    const pw = 'MandantTest1!';

    // 1) Zwei Firmen anlegen
    const aRes = await request.post('/api/companies', { headers: sa.headers, data: { name: `e2e-A-${uniq()}` } });
    expect(aRes.status()).toBe(201);
    const companyA = (await aRes.json()).id;
    const bRes = await request.post('/api/companies', { headers: sa.headers, data: { name: `e2e-B-${uniq()}` } });
    expect(bRes.status()).toBe(201);
    const companyB = (await bRes.json()).id;

    // 2) In jeder Firma einen Mitarbeiter + in A einen Firmen-Admin anlegen
    const mkUser = async (companyId, role) => {
      const email = `e2e-mt-${uniq()}@test.local`;
      const r = await request.post('/api/users', {
        headers: sa.headers,
        data: { email, password: pw, firstName: 'MT', lastName: 'User', role, vacationDays: 25, companyId },
      });
      expect(r.status()).toBe(201);
      return { id: (await r.json()).user.id, email };
    };
    const adminA = await mkUser(companyA, 'admin');
    const userA = await mkUser(companyA, 'employee');
    const userB = await mkUser(companyB, 'employee');

    // 3) Firmen-Admin von A einloggen
    const liA = await request.post('/api/auth/login', { data: { email: adminA.email, password: pw } });
    expect(liA.ok()).toBeTruthy();
    const tokA = (await liA.json()).token;
    const headersA = { Authorization: `Bearer ${tokA}` };

    // 4) Firmen-Admin A sieht nur Firma-A-Nutzer (userA, adminA), NICHT userB
    const usersResp = await request.get('/api/users', { headers: headersA });
    expect(usersResp.ok()).toBeTruthy();
    const list = (await usersResp.json()).users || (await usersResp.json());
    const ids = list.map((u) => u.id);
    expect(ids).toContain(userA.id);
    expect(ids).toContain(adminA.id);
    expect(ids).not.toContain(userB.id);

    // 5) Firmen-Admin ist KEIN Super-Admin → keine Firmenverwaltung
    const compForbidden = await request.get('/api/companies', { headers: headersA });
    expect(compForbidden.status()).toBe(403);

    // 6) Aufräumen: Nutzer (werden auch per globalTeardown gelöscht) + Firmen
    for (const u of [adminA, userA, userB]) {
      await request.delete(`/api/users/${u.id}`, { headers: sa.headers });
    }
    await request.delete(`/api/companies/${companyA}`, { headers: sa.headers });
    await request.delete(`/api/companies/${companyB}`, { headers: sa.headers });
  });

  test('Super-Admin verwaltet Mandanten (Tenants) und ordnet Firmen zu', async ({ request }) => {
    const sa = await login(request, 'admin');

    // Mandant anlegen
    const tRes = await request.post('/api/tenants', { headers: sa.headers, data: { name: `e2e-T-${uniq()}` } });
    expect(tRes.status()).toBe(201);
    const tenantId = (await tRes.json()).id;

    // Mandant erscheint in der Liste
    const list = (await (await request.get('/api/tenants', { headers: sa.headers })).json()).tenants;
    expect(list.map((t) => t.id)).toContain(tenantId);

    // Firma diesem Mandanten zuordnen
    const cRes = await request.post('/api/companies', { headers: sa.headers, data: { name: `e2e-C-${uniq()}`, tenantId } });
    expect(cRes.status()).toBe(201);
    const companyId = (await cRes.json()).id;
    const comp = await (await request.get('/api/companies', { headers: sa.headers })).json();
    expect(comp.companies.find((c) => c.id === companyId)?.tenantId).toBe(tenantId);

    // Mandant mit zugeordneter Firma darf NICHT löschbar sein → 400
    expect((await request.delete(`/api/tenants/${tenantId}`, { headers: sa.headers })).status()).toBe(400);

    // Aufräumen: Firma weg, dann Mandant
    await request.delete(`/api/companies/${companyId}`, { headers: sa.headers });
    expect((await request.delete(`/api/tenants/${tenantId}`, { headers: sa.headers })).ok()).toBeTruthy();

    // Nicht-Super-Admin (Employee) darf keine Mandanten verwalten → 403
    const emp = await login(request, 'employee');
    expect((await request.get('/api/tenants', { headers: emp.headers })).status()).toBe(403);
  });

  test('Mandanten-Admin verwaltet nur Firmen seines Mandanten und sieht nur dessen Nutzer', async ({ request }) => {
    const sa = await login(request, 'admin');
    const pw = 'MandantAdmin1!';
    // Zwei Mandanten mit je einer Firma + Nutzer
    const tA = (await (await request.post('/api/tenants', { headers: sa.headers, data: { name: `e2e-TA-${uniq()}` } })).json()).id;
    const tB = (await (await request.post('/api/tenants', { headers: sa.headers, data: { name: `e2e-TB-${uniq()}` } })).json()).id;
    const cA = (await (await request.post('/api/companies', { headers: sa.headers, data: { name: `e2e-CA-${uniq()}`, tenantId: tA } })).json()).id;
    const cB = (await (await request.post('/api/companies', { headers: sa.headers, data: { name: `e2e-CB-${uniq()}`, tenantId: tB } })).json()).id;
    const mkUser = async (companyId) => {
      const email = `e2e-mt-${uniq()}@test.local`;
      const r = await request.post('/api/users', { headers: sa.headers, data: { email, password: pw, firstName: 'MT', lastName: 'U', role: 'employee', vacationDays: 25, companyId } });
      return { id: (await r.json()).user.id, email };
    };
    const uA = await mkUser(cA);
    const uB = await mkUser(cB);
    // Mandanten-Admin für Tenant A (admin + tenantId, ohne companyId)
    const taEmail = `e2e-mt-admin-${uniq()}@test.local`;
    const taRes = await request.post('/api/users', { headers: sa.headers, data: { email: taEmail, password: pw, firstName: 'TA', lastName: 'Admin', role: 'admin', vacationDays: 25, tenantId: tA } });
    expect(taRes.status()).toBe(201);
    const taId = (await taRes.json()).user.id;

    const ta = { headers: { Authorization: `Bearer ${(await (await request.post('/api/auth/login', { data: { email: taEmail, password: pw } })).json()).token}` } };

    // Sieht nur Tenant-A-Nutzer (uA, sich selbst), nicht uB
    const ids = ((await (await request.get('/api/users', { headers: ta.headers })).json()).users || []).map((u) => u.id);
    expect(ids).toContain(uA.id);
    expect(ids).not.toContain(uB.id);

    // Firmen-Verwaltung: sieht nur Firma A
    const comps = (await (await request.get('/api/companies', { headers: ta.headers })).json()).companies.map((c) => c.id);
    expect(comps).toContain(cA);
    expect(comps).not.toContain(cB);
    // Darf Firma B (fremder Mandant) nicht bearbeiten → 404
    expect((await request.put(`/api/companies/${cB}`, { headers: ta.headers, data: { name: 'hack' } })).status()).toBe(404);
    // Darf keine Mandanten verwalten → 403
    expect((await request.get('/api/tenants', { headers: ta.headers })).status()).toBe(403);

    // Aufräumen
    for (const id of [uA.id, uB.id, taId]) await request.delete(`/api/users/${id}`, { headers: sa.headers });
    for (const id of [cA, cB]) await request.delete(`/api/companies/${id}`, { headers: sa.headers });
    for (const id of [tA, tB]) await request.delete(`/api/tenants/${id}`, { headers: sa.headers });
  });

  test('Mandanten-Admin OHNE Firmen erhält keinen Zugriff (kein Empty-Set-Bypass)', async ({ request }) => {
    const sa = await login(request, 'admin');
    const pw = 'EmptyTenant1!';
    // Leerer Mandant (keine Firma) + dessen Admin
    const tEmpty = (await (await request.post('/api/tenants', { headers: sa.headers, data: { name: `e2e-TE-${uniq()}` } })).json()).id;
    const taEmail = `e2e-mt-empty-${uniq()}@test.local`;
    await request.post('/api/users', { headers: sa.headers, data: { email: taEmail, password: pw, firstName: 'Empty', lastName: 'Admin', role: 'admin', vacationDays: 25, tenantId: tEmpty } });
    const ta = { headers: { Authorization: `Bearer ${(await (await request.post('/api/auth/login', { data: { email: taEmail, password: pw } })).json()).token}` } };

    // Fremde Firma + Gruppe (separater Mandant)
    const tOther = (await (await request.post('/api/tenants', { headers: sa.headers, data: { name: `e2e-TO-${uniq()}` } })).json()).id;
    const cOther = (await (await request.post('/api/companies', { headers: sa.headers, data: { name: `e2e-CO-${uniq()}`, tenantId: tOther } })).json()).id;
    const grp = await request.post('/api/groups', { headers: sa.headers, data: { name: `e2e-G-${uniq()}`, companyId: cOther } });
    const grpId = (await grp.json()).group.id;

    // Empty-Tenant-Admin darf die fremde Gruppe NICHT lesen/ändern (kein Bypass) → 404
    expect((await request.get(`/api/groups/${grpId}`, { headers: ta.headers })).status()).toBe(404);
    expect((await request.put(`/api/groups/${grpId}`, { headers: ta.headers, data: { name: 'hack' } })).status()).toBe(404);
    // Sieht keine Nutzer (sein Tenant hat keine Firmen; er selbst ist firmenlos) → 0, kein Leak
    const ids = ((await (await request.get('/api/users', { headers: ta.headers })).json()).users || []).map((u) => u.id);
    expect(ids.length).toBe(0);

    // Aufräumen
    await request.delete(`/api/groups/${grpId}`, { headers: sa.headers });
    await request.delete(`/api/companies/${cOther}`, { headers: sa.headers });
    const taId = ((await (await request.get('/api/users', { headers: sa.headers })).json()).users || []).find((u) => u.email === taEmail)?.id;
    if (taId) await request.delete(`/api/users/${taId}`, { headers: sa.headers });
    for (const id of [tEmpty, tOther]) await request.delete(`/api/tenants/${id}`, { headers: sa.headers });
  });

  test('Firmen-Admin kann keine Daten fremder Firmen lesen (Team-Vacations + Krankschein-Anhänge)', async ({ request }) => {
    test.setTimeout(60000); // viele Schritte (2 Firmen/Nutzer + Gruppe + Direkteintrag + Anhang-Upload + Logins)
    const sa = await login(request, 'admin');
    const pw = 'CrossRead1!';
    // Firma A (mit Admin) + Firma B (mit Mitarbeiter, Gruppe, Antrag, Anhang)
    const cA = (await (await request.post('/api/companies', { headers: sa.headers, data: { name: `e2e-XA-${uniq()}` } })).json()).id;
    const cB = (await (await request.post('/api/companies', { headers: sa.headers, data: { name: `e2e-XB-${uniq()}` } })).json()).id;
    const mk = async (companyId, role) => {
      const email = `e2e-xr-${uniq()}@test.local`;
      const r = await request.post('/api/users', { headers: sa.headers, data: { email, password: pw, firstName: 'XR', lastName: 'U', role, vacationDays: 25, companyId } });
      return { id: (await r.json()).user.id, email };
    };
    const adminA = await mk(cA, 'admin');
    const empB = await mk(cB, 'employee');
    const grpB = (await (await request.post('/api/groups', { headers: sa.headers, data: { name: `e2e-XGB-${uniq()}`, companyId: cB } })).json()).group.id;
    await request.put(`/api/users/${empB.id}`, { headers: sa.headers, data: { groupId: grpB } });

    // Antrag + Anhang für empB (über Super-Admin)
    await request.post('/api/vacations/direct-entry', { headers: sa.headers, data: { userId: empB.id, ...futureRange(320, 5), type: 'vacation', durationType: 'full_day' } });
    const all = (await (await request.get('/api/vacations', { headers: sa.headers })).json()).vacations || [];
    const reqId = all.filter((v) => v.userId === empB.id).sort((a, b) => b.id - a.id)[0].id;
    const up = await request.post(`/api/vacations/${reqId}/attachments`, { headers: { Authorization: sa.headers.Authorization }, multipart: { file: { name: 'beleg.pdf', mimeType: 'application/pdf', buffer: PDF } } });
    const attId = (await up.json()).attachment.id;

    const a = { headers: { Authorization: `Bearer ${(await (await request.post('/api/auth/login', { data: { email: adminA.email, password: pw } })).json()).token}` } };

    // Firmen-Admin A darf NICHT auf Firma-B-Team/-Anhänge zugreifen
    expect((await request.get(`/api/vacations/team/${grpB}`, { headers: a.headers })).status()).toBe(403);
    expect((await request.get(`/api/vacations/${reqId}/attachments`, { headers: a.headers })).status()).toBe(403);
    expect((await request.get(`/api/vacations/attachments/${attId}/download`, { headers: a.headers })).status()).toBe(403);

    // Aufräumen
    await request.delete(`/api/vacations/attachments/${attId}`, { headers: sa.headers });
    for (const id of [adminA.id, empB.id]) await request.delete(`/api/users/${id}`, { headers: sa.headers });
    await request.delete(`/api/groups/${grpB}`, { headers: sa.headers });
    for (const id of [cA, cB]) await request.delete(`/api/companies/${id}`, { headers: sa.headers });
  });

  test('Admin/HR ohne Firma+Mandant nur als ausdrücklicher Super-Admin (kein versehentlicher Global-Admin)', async ({ request }) => {
    const sa = await login(request, 'admin');
    const pw = 'GuardTest1!';
    const mk = (extra) => ({ email: `e2e-guard-${uniq()}@test.local`, password: pw, firstName: 'G', lastName: 'A', role: 'admin', vacationDays: 25, ...extra });

    // admin ohne Firma + ohne Mandant + ohne Super-Flag → abgelehnt (400)
    const r1 = await request.post('/api/users', { headers: sa.headers, data: mk({}) });
    expect(r1.status()).toBe(400);

    // mit ausdrücklichem Super-Admin-Flag → erlaubt (201)
    const r2 = await request.post('/api/users', { headers: sa.headers, data: mk({ isSuperAdmin: true }) });
    expect(r2.status()).toBe(201);
    const superId = (await r2.json()).user.id;

    // Per Update darf ein bestehender Super-Admin nicht versehentlich „entschärft+firmenlos" werden:
    // Super-Flag entfernen, ohne Firma/Mandant → 400
    expect((await request.put(`/api/users/${superId}`, { headers: sa.headers, data: { isSuperAdmin: false } })).status()).toBe(400);

    await request.delete(`/api/users/${superId}`, { headers: sa.headers });
  });

  test('SMTP-Einstellungen nur für Super-Admin', async ({ request }) => {
    const sa = await login(request, 'admin'); // Super-Admin
    expect((await request.get('/api/settings/email', { headers: sa.headers })).ok()).toBeTruthy();
    // Firmen-Admin (e2e-hr/limited): erst einen firmen-gebundenen Admin anlegen
    const pw = 'SmtpTest1!';
    const c = (await (await request.post('/api/companies', { headers: sa.headers, data: { name: `e2e-SC-${uniq()}` } })).json()).id;
    const email = `e2e-smtp-admin-${uniq()}@test.local`;
    const r = await request.post('/api/users', { headers: sa.headers, data: { email, password: pw, firstName: 'Smtp', lastName: 'Admin', role: 'admin', vacationDays: 25, companyId: c } });
    const uid = (await r.json()).user.id;
    const ca = { headers: { Authorization: `Bearer ${(await (await request.post('/api/auth/login', { data: { email, password: pw } })).json()).token}` } };
    expect((await request.get('/api/settings/email', { headers: ca.headers })).status()).toBe(403);
    expect((await request.put('/api/settings/email', { headers: ca.headers, data: { smtpHost: 'evil' } })).status()).toBe(403);
    await request.delete(`/api/users/${uid}`, { headers: sa.headers });
    await request.delete(`/api/companies/${c}`, { headers: sa.headers });
  });
});
