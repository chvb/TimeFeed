// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('Abwesenheits-Übersicht (Wer ist abwesend?)', () => {
  test('Endpoint liefert gescopte Abwesenheitsliste', async ({ request }) => {
    const admin = await login(request, 'admin');
    const r = await request.get('/api/vacations/absences', { headers: admin.headers });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(Array.isArray(body.absences)).toBeTruthy();

    // Mit Zeitraum
    const r2 = await request.get('/api/vacations/absences?from=2026-01-01&to=2026-12-31', { headers: admin.headers });
    expect(r2.ok()).toBeTruthy();

    // Auch für Mitarbeiter abrufbar (gescopet)
    const emp = await login(request, 'employee');
    expect((await request.get('/api/vacations/absences', { headers: emp.headers })).ok()).toBeTruthy();
  });
});
