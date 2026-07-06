// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('Settings & Audit', () => {
  test('Admin liest Systemeinstellungen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const res = await request.get('/api/settings', { headers: admin.headers });
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toHaveProperty('companyName');
  });

  test('Admin speichert Systemeinstellungen (Round-Trip)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const current = await (await request.get('/api/settings', { headers: admin.headers })).json();
    expect((await request.put('/api/settings', { headers: admin.headers, data: current })).ok()).toBeTruthy();
  });

  test('Admin liest und speichert Report-Einstellungen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const res = await request.get('/api/settings/reports', { headers: admin.headers });
    expect(res.ok()).toBeTruthy();
    const current = await res.json();
    expect((await request.put('/api/settings/reports', { headers: admin.headers, data: current })).ok()).toBeTruthy();
  });

  test('Einstellungen speichern mit ungültigem Typ → 400 (Validierung)', async ({ request }) => {
    const admin = await login(request, 'admin');
    expect((await request.put('/api/settings', { headers: admin.headers, data: { defaultVacationDays: 'viele' } })).status()).toBe(400);
    expect((await request.put('/api/settings', { headers: admin.headers, data: { emailNotifications: 'ja' } })).status()).toBe(400);
  });

  test('Admin liest Audit-Logs, -Stats und -Filter', async ({ request }) => {
    const admin = await login(request, 'admin');
    expect((await request.get('/api/audit', { headers: admin.headers })).ok()).toBeTruthy();
    expect((await request.get('/api/audit/stats', { headers: admin.headers })).ok()).toBeTruthy();
    expect((await request.get('/api/audit/filters', { headers: admin.headers })).ok()).toBeTruthy();
  });

  test('Audit-Logs mit Query-Parametern (limit)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const res = await request.get('/api/audit?limit=5', { headers: admin.headers });
    expect(res.ok()).toBeTruthy();
  });

  test('Employee darf Einstellungen/Audit/Reports NICHT → 403', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.get('/api/settings', { headers: emp.headers })).status()).toBe(403);
    expect((await request.get('/api/audit', { headers: emp.headers })).status()).toBe(403);
    expect((await request.get('/api/settings/reports', { headers: emp.headers })).status()).toBe(403);
    expect((await request.post('/api/settings/refresh-holidays', { headers: emp.headers })).status()).toBe(403);
  });
});
