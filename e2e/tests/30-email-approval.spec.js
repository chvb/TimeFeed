// @ts-check
const { test, expect } = require('@playwright/test');
const { login, futureRange } = require('./helpers');

test.describe('E-Mail-Genehmigungslink', () => {
  test('Token wird nicht an den Antragsteller geleakt', async ({ request }) => {
    const emp = await login(request, 'employee');
    const r = await request.post('/api/vacations', { headers: emp.headers, data: { ...futureRange(245, 6), type: 'vacation' } });
    expect(r.status()).toBe(201);
    const v = (await r.json()).vacation;
    expect(v.approvalToken).toBeUndefined();
    const admin = await login(request, 'admin');
    await request.delete(`/api/vacations/${v.id}`, { headers: admin.headers });
  });

  test('Ungültiger Token → 404, keine Auth nötig', async ({ request }) => {
    const res = await request.get('/api/vacation-action/0000000000000000deadbeef?do=approve');
    expect(res.status()).toBe(404);
  });
});
