// @ts-check
// GPS-Modus (v1.1.0): Einstellungen → Zeiterfassung. UI-Umstellung über einen
// FIRMEN-Admin (der geseedete Super-Admin editiert ohne ?companyId die globale
// Vorlage — Stempel-Validierung nutzt aber die Firmen-Einstellungen).
const { test, expect } = require('@playwright/test');
const { login, uiLogin, expectToast, ymd } = require('./helpers');

const GPS_ADMIN = { email: 'e2e-gps-admin@timefeed.de', password: 'E2eGpsAdmin_123!' };
const GPS_USER = { email: 'e2e-gps-gustav@timefeed.de', password: 'E2eGpsGustav_123!' };

async function ensureUser(request, adminHeaders, companyId, creds, extra) {
  const res = await request.post('/api/users', {
    headers: adminHeaders,
    data: { ...creds, companyId, ...extra },
  });
  expect([201, 400]).toContain(res.status()); // 400 = existiert bereits
}

async function setGpsModeViaUi(page, radioLabel) {
  await page.getByRole('radio', { name: radioLabel }).check();
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expectToast(page, 'Einstellungen gespeichert');
}

test.describe('GPS-Modus', () => {
  test('erforderlich → 400 GPS_REQUIRED · deaktiviert → lat=null · zurück auf optional', async ({ page, request }) => {
    const admin = await login(request, 'admin');
    await ensureUser(request, admin.headers, admin.user.companyId, {
      email: GPS_ADMIN.email, password: GPS_ADMIN.password,
      firstName: 'Greta', lastName: 'Gpsadmin', role: 'admin',
    });
    await ensureUser(request, admin.headers, admin.user.companyId, {
      email: GPS_USER.email, password: GPS_USER.password,
      firstName: 'Gustav', lastName: 'Gpsuser', role: 'mitarbeiter',
    });
    const emp = await login(request, GPS_USER);

    // --- UI: Radios sichtbar, auf „erforderlich" stellen ---
    await uiLogin(page, GPS_ADMIN);
    await page.goto('/settings?tab=time');
    await expect(page.getByText('Standort (GPS)')).toBeVisible();
    for (const label of ['GPS deaktiviert', 'Optional (Standard)', 'Akzeptieren mit Warnung', 'GPS erforderlich']) {
      await expect(page.getByRole('radio', { name: label })).toBeVisible();
    }
    await setGpsModeViaUi(page, 'GPS erforderlich');

    // Stempeln ohne GPS → 400 GPS_REQUIRED (Prüfung VOR der Sequenzvalidierung).
    const denied = await request.post('/api/time/stamp', {
      headers: emp.headers,
      data: { type: 'in' },
    });
    expect(denied.status()).toBe(400);
    expect((await denied.json()).error).toBe('GPS_REQUIRED');

    // --- „deaktiviert": Stempel MIT lat/lng wird OHNE Standort gespeichert ---
    await setGpsModeViaUi(page, 'GPS deaktiviert');

    const stampIn = await request.post('/api/time/stamp', {
      headers: emp.headers,
      data: { type: 'in', lat: 52.52, lng: 13.405, accuracy: 5 },
    });
    expect(stampIn.status()).toBe(201);
    const stampOut = await request.post('/api/time/stamp', {
      headers: emp.headers,
      data: { type: 'out', lat: 52.52, lng: 13.405 },
    });
    expect(stampOut.status()).toBe(201);

    // to=YYYY-MM-DD würde als Mitternacht geparst und heutige Stempel ausschließen.
    const entriesRes = await request.get(
      `/api/time/entries?userId=${emp.user.id}&from=${ymd()}T00:00:00&to=${ymd()}T23:59:59`,
      { headers: admin.headers }
    );
    expect(entriesRes.ok()).toBeTruthy();
    const { entries } = await entriesRes.json();
    expect(entries.length).toBeGreaterThanOrEqual(2);
    for (const e of entries) {
      expect(e.lat).toBeNull();
      expect(e.lng).toBeNull();
    }

    // --- Zurück auf „optional" + API-Verifikation ---
    await setGpsModeViaUi(page, 'Optional (Standard)');
    const gpsAdminApi = await login(request, GPS_ADMIN);
    const settings = await (await request.get('/api/settings', { headers: gpsAdminApi.headers })).json();
    expect((settings.settings || settings).gpsMode).toBe('optional');
  });
});
