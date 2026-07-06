// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('Reports', () => {
  test('Admin generiert einen CSV-Report', async ({ request }) => {
    const admin = await login(request, 'admin');
    const res = await request.post('/api/reports/generate', {
      headers: admin.headers,
      data: { type: 'yearly', format: 'csv' },
    });
    expect(res.ok()).toBeTruthy();
  });

  test('Report-Generierung: ungültiger Typ/Format → 400', async ({ request }) => {
    const admin = await login(request, 'admin');
    expect((await request.post('/api/reports/generate', { headers: admin.headers, data: { type: 'taeglich', format: 'csv' } })).status()).toBe(400);
    expect((await request.post('/api/reports/generate', { headers: admin.headers, data: { type: 'yearly', format: 'pdf' } })).status()).toBe(400);
  });

  test('Report per E-Mail: ohne Empfänger → 400 (Validierung, kein Versand)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const res = await request.post('/api/reports/email', {
      headers: admin.headers,
      data: { type: 'yearly', format: 'csv', emails: [] },
    });
    expect(res.status()).toBe(400);
  });

  test('HR darf Reports generieren', async ({ request }) => {
    const hr = await login(request, 'hr');
    const res = await request.post('/api/reports/generate', { headers: hr.headers, data: { type: 'monthly', format: 'csv' } });
    expect(res.ok()).toBeTruthy();
  });

  test('Employee darf keine Reports → 403', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.post('/api/reports/generate', { headers: emp.headers, data: { type: 'yearly', format: 'csv' } })).status()).toBe(403);
    expect((await request.post('/api/reports/email', { headers: emp.headers, data: { type: 'yearly', format: 'csv', emails: ['x@test.local'] } })).status()).toBe(403);
    expect((await request.post('/api/reports/trigger', { headers: emp.headers, data: { type: 'yearly' } })).status()).toBe(403);
  });

  test('Reports ohne Token → 401', async ({ request }) => {
    expect((await request.post('/api/reports/generate', { data: { type: 'yearly', format: 'csv' } })).status()).toBe(401);
  });
});
