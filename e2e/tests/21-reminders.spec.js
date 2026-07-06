// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('Proaktive Erinnerungen', () => {
  test('Admin kann Erinnerungslauf auslösen (Struktur)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const r = await request.post('/api/cleanup/reminders', { headers: admin.headers });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    // E-Mails sind im e2e-Setup deaktiviert → skipped, aber Endpunkt antwortet strukturiert.
    expect(body).toHaveProperty('carryover');
    expect(body).toHaveProperty('approvals');
    expect(body).toHaveProperty('certificates');
  });

  test('Erinnerungslauf nur für Admin', async ({ request }) => {
    const emp = await login(request, 'employee');
    const res = await request.post('/api/cleanup/reminders', { headers: emp.headers });
    expect(res.status()).toBe(403);
  });
});
