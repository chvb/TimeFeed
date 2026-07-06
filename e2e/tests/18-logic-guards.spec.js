// @ts-check
const { test, expect } = require('@playwright/test');
const { login, futureRange } = require('./helpers');

test.describe('Logik-Absicherungen (Audit-Fixes)', () => {
  test('Selbstgenehmigung nur wenn erlaubt', async ({ request }) => {
    const admin = await login(request, 'admin');
    const manager = await login(request, 'manager');

    await request.put('/api/settings', { headers: admin.headers, data: { allowSelfApproval: false } });
    const c = await request.post('/api/vacations', { headers: manager.headers, data: { ...futureRange(45, 2), type: 'personal', reason: 'self' } });
    expect(c.status()).toBe(201);
    const id = (await c.json()).vacation.id;

    const a1 = await request.post(`/api/vacations/${id}/approve`, { headers: manager.headers });
    expect(a1.status()).toBe(403);

    await request.put('/api/settings', { headers: admin.headers, data: { allowSelfApproval: true } });
    const a2 = await request.post(`/api/vacations/${id}/approve`, { headers: manager.headers });
    expect(a2.ok()).toBeTruthy();

    // zurücksetzen (Default) – Teardown entfernt den Antrag des Test-Managers.
    await request.put('/api/settings', { headers: admin.headers, data: { allowSelfApproval: false } });
  });

  test('Manager kann Anträge außerhalb seiner Gruppe nicht genehmigen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const manager = await login(request, 'manager');

    // Admin ist nicht in der vom Manager verwalteten Gruppe.
    const c = await request.post('/api/vacations', { headers: admin.headers, data: { ...futureRange(50, 3), type: 'personal' } });
    expect(c.status()).toBe(201);
    const id = (await c.json()).vacation.id;

    const a = await request.post(`/api/vacations/${id}/approve`, { headers: manager.headers });
    expect(a.status()).toBe(403);

    await request.delete(`/api/vacations/${id}`, { headers: admin.headers });
  });

  test('Mindestvorlaufzeit greift bei Urlaub', async ({ request }) => {
    const admin = await login(request, 'admin');
    const emp = await login(request, 'employee');

    await request.put('/api/settings', { headers: admin.headers, data: { minNoticeRequired: 14 } });

    const near = await request.post('/api/vacations', { headers: emp.headers, data: { ...futureRange(3, 3), type: 'vacation' } });
    expect(near.status()).toBe(400);

    const far = await request.post('/api/vacations', { headers: emp.headers, data: { ...futureRange(40, 3), type: 'vacation' } });
    expect(far.status()).toBe(201);
    await request.delete(`/api/vacations/${(await far.json()).vacation.id}`, { headers: admin.headers });

    await request.put('/api/settings', { headers: admin.headers, data: { minNoticeRequired: 7 } });
  });
});
