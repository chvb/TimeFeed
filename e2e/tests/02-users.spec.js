// @ts-check
const { test, expect } = require('@playwright/test');
const { login, uniq, PASSWORD } = require('./helpers');

test.describe('Users', () => {
  test('Admin sieht User-Liste', async ({ request }) => {
    const auth = await login(request, 'admin');
    const res = await request.get('/api/users', { headers: auth.headers });
    expect(res.ok()).toBeTruthy();
    expect(Array.isArray((await res.json()).users)).toBeTruthy();
  });

  test('Employee darf User-Liste NICHT sehen → 403', async ({ request }) => {
    const auth = await login(request, 'employee');
    expect((await request.get('/api/users', { headers: auth.headers })).status()).toBe(403);
  });

  test('Manager und HR dürfen die User-Liste sehen', async ({ request }) => {
    for (const role of ['manager', 'hr']) {
      const auth = await login(request, role);
      expect((await request.get('/api/users', { headers: auth.headers })).ok(), role).toBeTruthy();
    }
  });

  test('Admin: User anlegen, lesen, ändern, deaktivieren/aktivieren, Urlaubskonto, löschen', async ({ request }) => {
    const auth = await login(request, 'admin');
    const email = `e2e-tmp-${uniq()}@test.local`;
    const created = await request.post('/api/users', {
      headers: auth.headers,
      data: { email, password: 'TempPassw0rd!', firstName: 'Temp', lastName: 'User', role: 'employee', vacationDays: 25 },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).user.id;

    expect((await request.get(`/api/users/${id}`, { headers: auth.headers })).ok()).toBeTruthy();
    expect((await request.put(`/api/users/${id}`, { headers: auth.headers, data: { firstName: 'Temp2', vacationDays: 28 } })).ok()).toBeTruthy();
    expect((await request.post(`/api/users/${id}/deactivate`, { headers: auth.headers })).ok()).toBeTruthy();
    expect((await request.post(`/api/users/${id}/activate`, { headers: auth.headers })).ok()).toBeTruthy();
    expect((await request.get(`/api/users/${id}/vacation-balance`, { headers: auth.headers })).ok()).toBeTruthy();
    expect((await request.delete(`/api/users/${id}`, { headers: auth.headers })).ok()).toBeTruthy();
  });

  test('HR darf User anlegen', async ({ request }) => {
    const hr = await login(request, 'hr');
    const created = await request.post('/api/users', {
      headers: hr.headers,
      data: { email: `e2e-tmp-${uniq()}@test.local`, password: PASSWORD, firstName: 'Hr', lastName: 'Created', role: 'employee', vacationDays: 20 },
    });
    expect(created.status()).toBe(201);
    const admin = await login(request, 'admin');
    await request.delete(`/api/users/${(await created.json()).user.id}`, { headers: admin.headers });
  });

  test('User-Anlage Validierung: ungültige Rolle / kurzes Passwort / fehlende Urlaubstage → 400', async ({ request }) => {
    const auth = await login(request, 'admin');
    const base = { email: `e2e-tmp-${uniq()}@test.local`, password: 'GutesPw123', firstName: 'A', lastName: 'B', role: 'employee', vacationDays: 10 };
    expect((await request.post('/api/users', { headers: auth.headers, data: { ...base, role: 'superboss' } })).status()).toBe(400);
    expect((await request.post('/api/users', { headers: auth.headers, data: { ...base, password: '123' } })).status()).toBe(400);
    // Ohne vacationDays jetzt gültig (globaler Standard greift) → 201; danach aufräumen.
    const { vacationDays, ...noDays } = base;
    const r = await request.post('/api/users', { headers: auth.headers, data: { ...noDays, password: 'TempPassw0rd!', email: `e2e-nd-${uniq()}@test.local` } });
    expect(r.status()).toBe(201);
    await request.delete(`/api/users/${(await r.json()).user.id}`, { headers: auth.headers });
  });

  test('GET /api/users/:id für nicht existierenden User → 404', async ({ request }) => {
    const auth = await login(request, 'admin');
    const res = await request.get('/api/users/999999999', { headers: auth.headers });
    expect(res.status()).toBe(404);
  });

  test('Employee darf nur mit Token auf User-Detail zugreifen', async ({ request }) => {
    // ohne Token → 401
    expect((await request.get('/api/users/1')).status()).toBe(401);
  });
});
