// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('Erweiterte Auswertungen', () => {
  test('Analytics liefert Zeilen + Summen (Admin)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const r = await request.get('/api/reports/analytics?year=2026', { headers: admin.headers });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.year).toBe(2026);
    expect(Array.isArray(body.rows)).toBeTruthy();
    expect(body.totals).toHaveProperty('employees');
    expect(body.totals).toHaveProperty('sickDays');
    if (body.rows.length) {
      expect(body.rows[0]).toHaveProperty('bradford');
      expect(body.rows[0]).toHaveProperty('vacationTaken');
      expect(body.rows[0]).toHaveProperty('group');
      expect(body.rows[0]).toHaveProperty('department');
    }
  });

  test('Analytics akzeptiert Von-Bis-Zeitraum', async ({ request }) => {
    const admin = await login(request, 'admin');
    const r = await request.get('/api/reports/analytics?year=2026&from=2026-06-01&to=2026-06-30', { headers: admin.headers });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body.rows)).toBeTruthy();
  });

  test('Auswertungen nicht für einfache Mitarbeiter', async ({ request }) => {
    const emp = await login(request, 'employee');
    const res = await request.get('/api/reports/analytics', { headers: emp.headers });
    expect(res.status()).toBe(403);
  });
});
