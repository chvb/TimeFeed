// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('Feed-Extras', () => {
  test('liefert Jubiläen, neue Kolleg:innen und anstehende Feiertage (Struktur)', async ({ request }) => {
    const emp = await login(request, 'employee');
    const r = await request.get('/api/feed/extras', { headers: emp.headers });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body.anniversaries)).toBeTruthy();
    expect(Array.isArray(body.newJoiners)).toBeTruthy();
    expect(Array.isArray(body.upcomingHolidays)).toBeTruthy();
  });
});
