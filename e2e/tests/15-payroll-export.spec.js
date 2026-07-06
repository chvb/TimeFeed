// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

async function setFormat(request, headers, format) {
  const res = await request.put('/api/settings/reports', {
    headers,
    data: { payrollSettings: { exportFormat: format, beraternummer: '1234567', mandantennummer: '42' } },
  });
  expect(res.ok()).toBeTruthy();
}

async function exportDatev(request, headers) {
  const res = await request.post('/api/reports/generate', {
    headers,
    data: { type: 'monthly', format: 'datev' },
  });
  expect(res.ok()).toBeTruthy();
  return res.text();
}

test.describe('Lohn-Export (DATEV) konfigurierbar', () => {
  test('Format-Auswahl wird gespeichert und zurückgelesen', async ({ request }) => {
    const admin = await login(request, 'admin');
    await setFormat(request, admin.headers, 'lodas');
    const s = await (await request.get('/api/settings/reports', { headers: admin.headers })).json();
    expect(s.payrollSettings.exportFormat).toBe('lodas');
    expect(s.payrollSettings.beraternummer).toBe('1234567');
  });

  test('Export liefert je nach Einstellung LODAS bzw. CSV', async ({ request }) => {
    const admin = await login(request, 'admin');

    await setFormat(request, admin.headers, 'lodas');
    const lodas = await exportDatev(request, admin.headers);
    expect(lodas).toContain('Ziel=LODAS');
    expect(lodas).toContain('BeraterNr=1234567');

    await setFormat(request, admin.headers, 'csv');
    const csv = await exportDatev(request, admin.headers);
    expect(csv).toContain('Personalnummer;Nachname;Vorname');

    // Aufräumen: zurück auf Default.
    await setFormat(request, admin.headers, 'csv');
  });

  test('Lohn-Export nur für Admin (Employee → 403)', async ({ request }) => {
    const emp = await login(request, 'employee');
    const res = await request.post('/api/reports/generate', { headers: emp.headers, data: { type: 'monthly', format: 'datev' } });
    expect(res.status()).toBe(403);
  });
});
