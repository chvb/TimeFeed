// @ts-check
// Stundenzettel-Versand (v1.1.0): globaler Firmen-Toggle in den Einstellungen und
// Mitarbeiter-Select Standard/Immer/Nie — nur Settings-Roundtrip (kein SMTP im e2e).
const { test, expect } = require('@playwright/test');
const { USERS, login, uiLogin, expectToast } = require('./helpers');

const TS_ADMIN = { email: 'e2e-ts-admin@timefeed.de', password: 'E2eTsAdmin_123!' };
const TOGGLE_LABEL = 'Monats-Stundenzettel beim Monatsabschluss automatisch per E-Mail an die Mitarbeiter senden';

async function ensureTsAdmin(request) {
  const admin = await login(request, 'admin');
  const res = await request.post('/api/users', {
    headers: admin.headers,
    data: {
      email: TS_ADMIN.email, password: TS_ADMIN.password,
      firstName: 'Timo', lastName: 'Tsadmin', role: 'admin',
      companyId: admin.user.companyId,
    },
  });
  expect([201, 400]).toContain(res.status());
  return admin;
}

async function readCompanySettings(request) {
  const auth = await login(request, TS_ADMIN);
  const body = await (await request.get('/api/settings', { headers: auth.headers })).json();
  return body.settings || body;
}

test.describe('Stundenzettel-Versand', () => {
  test('Firmen-Toggle speichern (an → aus) mit API-Verifikation', async ({ page, request }) => {
    await ensureTsAdmin(request);

    await uiLogin(page, TS_ADMIN);
    await page.goto('/settings?tab=time');
    await expect(page.getByText('Stundenzettel-Versand')).toBeVisible();

    const toggle = page.getByLabel(TOGGLE_LABEL);
    await expect(toggle).toBeVisible();

    // Einschalten → speichern → API-Wert true.
    await toggle.check();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expectToast(page, 'Einstellungen gespeichert');
    expect((await readCompanySettings(request)).sendTimesheetOnClose).toBe(true);

    // Wieder ausschalten → API-Wert false.
    await toggle.uncheck();
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expectToast(page, 'Einstellungen gespeichert');
    expect((await readCompanySettings(request)).sendTimesheetOnClose).toBe(false);
  });

  test('Mitarbeiter-Modal: Select Standard/Immer/Nie speichern', async ({ page, request }) => {
    const admin = await ensureTsAdmin(request);
    const users = (await (await request.get('/api/users', { headers: admin.headers })).json()).users;
    const lisa = users.find((u) => u.email === USERS.mitarbeiter.email);

    const readMode = async () => {
      const body = await (await request.get(`/api/users/${lisa.id}`, { headers: admin.headers })).json();
      return (body.user || body).timesheetEmailMode;
    };

    await uiLogin(page, 'admin');
    await page.goto('/employees');

    const openModal = async () => {
      const row = page.getByRole('row', { name: new RegExp(USERS.mitarbeiter.name) });
      await expect(row).toBeVisible();
      await row.locator('button.text-primary-600').click();
      await expect(page.getByText('Mitarbeiter bearbeiten')).toBeVisible();
      // Das Stundenzettel-Select liegt auf dem Tab „Erweitert".
      await page.getByRole('button', { name: 'Erweitert' }).click();
      return page.locator('select', {
        has: page.locator('option', { hasText: 'Standard (globale Einstellung)' }),
      });
    };
    const saveModal = async () => {
      await page.getByRole('button', { name: 'Speichern', exact: true }).click();
      await expect(page.getByText('Mitarbeiter bearbeiten')).toBeHidden();
    };

    // „Immer" → 'on'
    let select = await openModal();
    await expect(page.getByText('Monats-Stundenzettel per E-Mail')).toBeVisible();
    await select.selectOption({ label: 'Immer' });
    await saveModal();
    expect(await readMode()).toBe('on');

    // „Nie" → 'off'
    select = await openModal();
    await select.selectOption({ label: 'Nie' });
    await saveModal();
    expect(await readMode()).toBe('off');

    // Zurück auf „Standard (globale Einstellung)" → 'inherit'
    select = await openModal();
    await select.selectOption({ label: 'Standard (globale Einstellung)' });
    await saveModal();
    expect(await readMode()).toBe('inherit');
  });
});
