// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('Mitarbeiter-CSV-Import', () => {
  test('Admin importiert Mitarbeiter (anlegen + aktualisieren)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const stamp = Date.now();
    const email = `import-${stamp}@test.local`;
    const csv = [
      'Vorname;Nachname;Email;Rolle;Abteilung;Urlaubstage;Eintritt',
      `Imp;Ort;${email};employee;Test;27;2026-02-01`,
      'bad;row;keine-email;employee;;;', // ungültige E-Mail → Fehler
    ].join('\n');

    const r = await request.post('/api/users/import', { headers: admin.headers, data: { csv } });
    expect(r.ok()).toBeTruthy();
    const body = await r.json();
    expect(body.created).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.errors)).toBeTruthy();
    expect(body.errors.length).toBeGreaterThanOrEqual(1);

    // Erneuter Import derselben E-Mail → Update statt Anlegen
    const csv2 = ['Vorname;Nachname;Email;Urlaubstage', `Imp;Ort;${email};30`].join('\n');
    const r2 = await request.post('/api/users/import', { headers: admin.headers, data: { csv: csv2 } });
    expect((await r2.json()).updated).toBeGreaterThanOrEqual(1);
  });

  test('Import nur für Admin/HR', async ({ request }) => {
    const emp = await login(request, 'employee');
    const res = await request.post('/api/users/import', { headers: emp.headers, data: { csv: 'email\nx@test.local' } });
    expect(res.status()).toBe(403);
  });
});
