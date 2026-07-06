// @ts-check
const { test, expect } = require('@playwright/test');
const { login, futureRange } = require('./helpers');

test.describe('Vertretung + Konfliktwarnung', () => {
  test('Vertretung wird gespeichert; Coverage-Endpoint liefert Überschneidungen', async ({ request }) => {
    const emp = await login(request, 'employee');

    const coll = await request.get('/api/users/colleagues', { headers: emp.headers });
    expect(coll.ok()).toBeTruthy();
    const list = (await coll.json()).colleagues;
    expect(Array.isArray(list)).toBeTruthy();
    const sub = list[0]?.id;

    const range = futureRange(200, 3);
    const c = await request.post('/api/vacations', {
      headers: emp.headers,
      data: { ...range, type: 'vacation', substituteId: sub },
    });
    expect(c.status()).toBe(201);
    const v = (await c.json()).vacation;
    expect(v.substituteId).toBe(sub);

    const cov = await request.get(`/api/vacations/coverage?startDate=${range.startDate}&endDate=${range.endDate}`, { headers: emp.headers });
    expect(cov.ok()).toBeTruthy();
    const body = await cov.json();
    expect(body).toHaveProperty('overlapping');
    expect(body).toHaveProperty('count');

    const admin = await login(request, 'admin');
    await request.delete(`/api/vacations/${v.id}`, { headers: admin.headers });
  });

  test('Coverage erfordert Datumsangaben', async ({ request }) => {
    const emp = await login(request, 'employee');
    const res = await request.get('/api/vacations/coverage', { headers: emp.headers });
    expect(res.status()).toBe(400);
  });
});
