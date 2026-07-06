// @ts-check
// Admin: Zeitmodell per UI anlegen, Gruppe zuordnen, Mitarbeiter-Override in Employees.
const { test, expect } = require('@playwright/test');
const { USERS, login, uiLogin, expectToast } = require('./helpers');

const MODEL_NAME = 'E2E Vollzeit 40h';

// Firmen-Admin (ohne Super-Admin-Flag) für die UI-Anlage: Der geseedete
// Demo-Admin ist Super-Admin MIT Firmenbindung — von ihm per UI angelegte
// Zeitmodelle landen als companyId=null („global") und sind anschließend in
// keiner Liste mehr sichtbar (echter App-Befund, siehe Testbericht). Ein
// regulärer Firmen-Admin legt Modelle korrekt firmengebunden an.
const FIRM_ADMIN = { email: 'e2e-firmadmin@timefeed.de', password: 'E2eFirmAdmin_123!' };

async function ensureFirmAdmin(request) {
  const admin = await login(request, 'admin');
  const res = await request.post('/api/users', {
    headers: admin.headers,
    data: {
      email: FIRM_ADMIN.email,
      password: FIRM_ADMIN.password,
      firstName: 'Frida',
      lastName: 'Firmenadmin',
      role: 'admin',
      companyId: admin.user.companyId,
    },
  });
  // 201 = angelegt; 400 „already registered" = existiert bereits (Wiederholungslauf).
  if (res.status() !== 201 && res.status() !== 400) {
    throw new Error(`Firmen-Admin konnte nicht angelegt werden: ${res.status()} ${await res.text()}`);
  }
}

async function getModelId(request) {
  const admin = await login(request, 'admin');
  const res = await request.get('/api/time-models', { headers: admin.headers });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  const list = body.timeModels || body.models || (Array.isArray(body) ? body : []);
  const model = list.find((m) => m.name === MODEL_NAME);
  expect(model, `Zeitmodell "${MODEL_NAME}" muss existieren`).toBeTruthy();
  return model.id;
}

test.describe('Zeitmodelle', () => {
  test('Admin legt ein Zeitmodell per UI an', async ({ page, request }) => {
    await ensureFirmAdmin(request);
    await uiLogin(page, FIRM_ADMIN);
    await page.goto('/time-models');
    await expect(page.getByRole('heading', { name: 'Zeitmodelle' })).toBeVisible();

    await page.getByRole('button', { name: 'Zeitmodell hinzufügen' }).click();
    await expect(page.getByText('Neues Zeitmodell')).toBeVisible();

    await page.getByPlaceholder('z. B. Vollzeit 40h').fill(MODEL_NAME);
    // Wochentage sind mit 08:00 (Mo–Fr) vorbelegt → Wochensumme 40:00 h.
    await expect(page.getByText('Wochensumme: 40:00 h')).toBeVisible();

    await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await expectToast(page, 'Zeitmodell gespeichert');

    await expect(page.getByRole('cell', { name: MODEL_NAME })).toBeVisible();
    await expect(page.getByRole('cell', { name: '40:00 h' })).toBeVisible();
  });

  test('Gruppe „Entwicklung" bekommt das Zeitmodell zugeordnet', async ({ page, request }) => {
    const modelId = await getModelId(request);

    await uiLogin(page, 'admin');
    await page.goto('/groups');
    await expect(page.getByRole('heading', { name: 'Gruppen & Abteilungen' })).toBeVisible();

    const row = page.getByRole('row', { name: /Entwicklung/ });
    await expect(row).toBeVisible();
    await row.locator('button.text-primary-600').click();

    await expect(page.getByText('Gruppe bearbeiten')).toBeVisible();
    const tmSelect = page.locator('select', {
      has: page.locator('option', { hasText: 'Kein Zeitmodell' }),
    });
    await tmSelect.selectOption({ label: MODEL_NAME });
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByText('Gruppe bearbeiten')).toBeHidden();

    // Verifikation über die API: Gruppe trägt das Zeitmodell.
    const admin = await login(request, 'admin');
    const groups = (await (await request.get('/api/groups', { headers: admin.headers })).json()).groups;
    const dev = groups.find((g) => g.name === 'Entwicklung');
    expect(dev.timeModelId).toBe(modelId);
  });

  test('Mitarbeiter-Override im Employees-Dialog', async ({ page, request }) => {
    const modelId = await getModelId(request);

    await uiLogin(page, 'admin');
    await page.goto('/employees');

    const row = page.getByRole('row', { name: new RegExp(USERS.mitarbeiter.name) });
    await expect(row).toBeVisible();
    await row.locator('button.text-primary-600').click();

    await expect(page.getByText('Mitarbeiter bearbeiten')).toBeVisible();
    await page.getByRole('button', { name: 'Erweitert' }).click();

    const overrideSelect = page.locator('select', {
      has: page.locator('option', { hasText: 'Gruppenmodell / Standard verwenden' }),
    });
    await overrideSelect.selectOption({ label: MODEL_NAME });
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByText('Mitarbeiter bearbeiten')).toBeHidden();

    // Verifikation über die API: User trägt den Override.
    const admin = await login(request, 'admin');
    const users = (await (await request.get('/api/users', { headers: admin.headers })).json()).users;
    const lisa = users.find((u) => u.email === USERS.mitarbeiter.email);
    expect(lisa.timeModelId).toBe(modelId);
  });
});
