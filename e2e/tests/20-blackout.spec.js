// @ts-check
const { test, expect } = require('@playwright/test');
const { login, futureRange } = require('./helpers');

test.describe('Sperrzeiten (Blackout)', () => {
  test('Antrag im gesperrten Zeitraum wird blockiert', async ({ request }) => {
    const admin = await login(request, 'admin');
    const emp = await login(request, 'employee');

    const range = futureRange(60, 5); // 5 Tage, ~60 Tage in der Zukunft
    const c = await request.post('/api/blackouts', {
      headers: admin.headers,
      data: { name: 'e2e-Sperrzeit', startDate: range.startDate, endDate: range.endDate },
    });
    expect(c.status()).toBe(201);
    const id = (await c.json()).blackout.id;

    // Urlaub im Sperrzeitraum → 400
    const blocked = await request.post('/api/vacations', { headers: emp.headers, data: { ...range, type: 'vacation' } });
    expect(blocked.status()).toBe(400);

    // Außerhalb (deutlich später) → 201
    const ok = await request.post('/api/vacations', { headers: emp.headers, data: { ...futureRange(120, 3), type: 'vacation' } });
    expect(ok.status()).toBe(201);
    await request.delete(`/api/vacations/${(await ok.json()).vacation.id}`, { headers: admin.headers });

    // Aufräumen
    await request.delete(`/api/blackouts/${id}`, { headers: admin.headers });
  });

  test('Sperrzeiten nur von Admin/HR verwaltbar', async ({ request }) => {
    const emp = await login(request, 'employee');
    const res = await request.post('/api/blackouts', { headers: emp.headers, data: { name: 'x', startDate: '2030-01-01', endDate: '2030-01-02' } });
    expect(res.status()).toBe(403);
  });
});
