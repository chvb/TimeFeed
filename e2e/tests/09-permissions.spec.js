// @ts-check
const { test, expect } = require('@playwright/test');
const { login, uniq } = require('./helpers');

test.describe('Permissions (RBAC)', () => {
  test('Unauthentifizierte Zugriffe → 401', async ({ request }) => {
    const urls = ['/api/users', '/api/vacations', '/api/groups', '/api/holidays', '/api/departments', '/api/sick-leaves', '/api/settings', '/api/audit'];
    for (const url of urls) {
      expect((await request.get(url)).status(), `${url} ohne Token`).toBe(401);
    }
  });

  test('Employee ist von Admin-Aktionen ausgeschlossen → 403', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.post('/api/users', { headers: emp.headers, data: { email: `x-${uniq()}@test.local`, password: 'Passw0rd!', firstName: 'X', lastName: 'Y', role: 'employee', vacationDays: 10 } })).status()).toBe(403);
    expect((await request.post('/api/groups', { headers: emp.headers, data: { name: `x-${uniq()}` } })).status()).toBe(403);
    expect((await request.put('/api/settings', { headers: emp.headers, data: {} })).status()).toBe(403);
    expect((await request.post('/api/holidays', { headers: emp.headers, data: { name: `x-${uniq()}`, date: '2030-01-01' } })).status()).toBe(403);
    expect((await request.post('/api/departments', { headers: emp.headers, data: { name: `x-${uniq()}` } })).status()).toBe(403);
  });

  test('Rollen-Lesezugriff auf User-Liste (admin/hr/manager erlaubt, employee verboten)', async ({ request }) => {
    for (const role of ['admin', 'hr', 'manager']) {
      const auth = await login(request, role);
      expect((await request.get('/api/users', { headers: auth.headers })).ok(), `${role}`).toBeTruthy();
    }
    const emp = await login(request, 'employee');
    expect((await request.get('/api/users', { headers: emp.headers })).status()).toBe(403);
  });

  test('Alle Rollen dürfen eigene Urlaube und Kalender sehen', async ({ request }) => {
    for (const role of ['admin', 'hr', 'manager', 'employee']) {
      const auth = await login(request, role);
      expect((await request.get('/api/vacations/my', { headers: auth.headers })).ok(), `${role} /my`).toBeTruthy();
      expect((await request.get('/api/vacations/calendar', { headers: auth.headers })).ok(), `${role} /calendar`).toBeTruthy();
    }
  });
});
