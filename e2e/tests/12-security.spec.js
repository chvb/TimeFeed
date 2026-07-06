// @ts-check
// Tests, die die Security-Fixes (Audit) absichern: Privilege Escalation & IDOR.
const { test, expect } = require('@playwright/test');
const { login, uniq, PASSWORD, futureRange, TEST_USERS } = require('./helpers');

function randRange(len = 3) {
  return futureRange(300 + Math.floor(Math.random() * 900), len);
}

async function loginWith(request, email, password) {
  const r = await request.post('/api/auth/login', { data: { email, password } });
  const d = await r.json();
  return { headers: { Authorization: `Bearer ${d.token}` }, user: d.user };
}

// Legt einen zusätzlichen Mitarbeiter ("Angreifer") an und loggt ihn ein.
async function createEmployee(request, adminHeaders) {
  const email = `e2e-tmp-${uniq()}@test.local`;
  const created = await request.post('/api/users', {
    headers: adminHeaders,
    data: { email, password: PASSWORD, firstName: 'Atk', lastName: 'User', role: 'employee', vacationDays: 5 },
  });
  const id = (await created.json()).user.id;
  const auth = await loginWith(request, email, PASSWORD);
  return { id, ...auth };
}

test.describe('Security: Privilege Escalation', () => {
  test('Selbstregistrierung ist deaktiviert (kein Self-Admin möglich)', async ({ request }) => {
    // Öffentliche Registrierung standardmäßig aus → Rollen-Eskalation per Self-Register
    // ist gar nicht erst möglich. (Bei ALLOW_SELF_REGISTRATION=true bliebe role=employee erzwungen.)
    const email = `e2e-reg-${uniq()}@test.local`;
    const res = await request.post('/api/auth/register', {
      data: { email, password: 'GutesPw12345!', firstName: 'R', lastName: 'X', role: 'admin' },
    });
    expect(res.status()).toBe(403);
  });

  test('HR darf Rolle NICHT auf admin setzen, Admin schon; Admin nicht die eigene', async ({ request }) => {
    const admin = await login(request, 'admin');
    const email = `e2e-tmp-${uniq()}@test.local`;
    const created = await request.post('/api/users', {
      headers: admin.headers,
      data: { email, password: PASSWORD, firstName: 'Role', lastName: 'Test', role: 'employee', vacationDays: 10 },
    });
    const id = (await created.json()).user.id;

    // HR → 403
    const hr = await login(request, 'hr');
    expect((await request.put(`/api/users/${id}`, { headers: hr.headers, data: { role: 'admin' } })).status()).toBe(403);

    // Admin → erlaubt
    expect((await request.put(`/api/users/${id}`, { headers: admin.headers, data: { role: 'manager' } })).ok()).toBeTruthy();

    // Admin darf eigene Rolle nicht ändern → 403
    expect((await request.put(`/api/users/${admin.user.id}`, { headers: admin.headers, data: { role: 'employee' } })).status()).toBe(403);

    await request.delete(`/api/users/${id}`, { headers: admin.headers });
  });
});

test.describe('Security: Header', () => {
  test('Content-Security-Policy ist gesetzt (default-src self)', async ({ request }) => {
    const res = await request.get('/health');
    const csp = res.headers()['content-security-policy'] || '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
  });
});

test.describe('Security: IDOR', () => {
  test('Fremder Urlaubsantrag ist für anderen Mitarbeiter nicht lesbar (403), für Eigentümer schon', async ({ request }) => {
    const emp = await login(request, 'employee');
    const id = (await (await request.post('/api/vacations', { headers: emp.headers, data: { ...randRange(), type: 'personal' } })).json()).vacation.id;

    const admin = await login(request, 'admin');
    const attacker = await createEmployee(request, admin.headers);

    expect((await request.get(`/api/vacations/${id}`, { headers: attacker.headers })).status()).toBe(403);
    expect((await request.get(`/api/vacations/${id}`, { headers: emp.headers })).ok()).toBeTruthy();
    expect((await request.get(`/api/vacations/${id}`, { headers: admin.headers })).ok()).toBeTruthy();

    await request.delete(`/api/vacations/${id}`, { headers: admin.headers });
    await request.delete(`/api/users/${attacker.id}`, { headers: admin.headers });
  });

  test('GET /api/vacations ist für Mitarbeiter auf eigene Anträge beschränkt', async ({ request }) => {
    const emp = await login(request, 'employee');
    await request.post('/api/vacations', { headers: emp.headers, data: { ...randRange(), type: 'personal' } });
    const res = await request.get('/api/vacations', { headers: emp.headers });
    expect(res.ok()).toBeTruthy();
    const { vacations } = await res.json();
    expect(vacations.every((v) => v.userId === emp.user.id)).toBeTruthy();
  });

  test('Krankmeldung (Gesundheitsdaten) ist nicht fremd-lesbar', async ({ request }) => {
    const admin = await login(request, 'admin');
    const emp = await login(request, 'employee');
    const r = futureRange(200 + Math.floor(Math.random() * 600), 2);
    const created = await request.post('/api/sick-leaves', { headers: admin.headers, data: { userId: emp.user.id, startDate: r.startDate, endDate: r.endDate } });
    const id = (await created.json()).sickLeave.id;

    const attacker = await createEmployee(request, admin.headers);
    // Detail
    expect((await request.get(`/api/sick-leaves/${id}`, { headers: attacker.headers })).status()).toBe(403);
    // Liste eines fremden Users
    expect((await request.get(`/api/sick-leaves/user/${emp.user.id}`, { headers: attacker.headers })).status()).toBe(403);
    // Eigentümer + Admin dürfen
    expect((await request.get(`/api/sick-leaves/${id}`, { headers: emp.headers })).ok()).toBeTruthy();
    expect((await request.get(`/api/sick-leaves/user/${emp.user.id}`, { headers: emp.headers })).ok()).toBeTruthy();
    expect((await request.get(`/api/sick-leaves/${id}`, { headers: admin.headers })).ok()).toBeTruthy();

    await request.delete(`/api/sick-leaves/${id}`, { headers: admin.headers });
    await request.delete(`/api/users/${attacker.id}`, { headers: admin.headers });
  });

  test('Team-Urlaube fremder Gruppen sind für Mitarbeiter gesperrt (403), Admin erlaubt', async ({ request }) => {
    const admin = await login(request, 'admin');
    const gid = (await (await request.post('/api/groups', { headers: admin.headers, data: { name: `e2e-group-${uniq()}` } })).json()).group.id;
    const emp = await login(request, 'employee'); // gehört keiner Gruppe an
    expect((await request.get(`/api/vacations/team/${gid}`, { headers: emp.headers })).status()).toBe(403);
    expect((await request.get(`/api/vacations/team/${gid}`, { headers: admin.headers })).ok()).toBeTruthy();
    await request.delete(`/api/groups/${gid}`, { headers: admin.headers });
  });
});
