// @ts-check
// Kiosk-Terminal: Admin legt Terminal per API an (Token), Setup + Code-Stempeln im /terminal-Screen.
const { test, expect } = require('@playwright/test');
const { USERS, login } = require('./helpers');

/** Stempel-Code über den Touch-Nummernblock eingeben und mit OK bestätigen. */
async function enterCode(page, code) {
  for (const digit of String(code)) {
    await page.getByRole('button', { name: digit, exact: true }).click();
  }
  await page.getByRole('button', { name: 'OK', exact: true }).click();
}

test.describe('Terminal (Kiosk)', () => {
  test('Setup mit Token, Kommen/Gehen über Code-Eingabe', async ({ page, request }) => {
    // Terminal per API anlegen — Token kommt EINMALIG in der Create-Antwort.
    const admin = await login(request, 'admin');
    const created = await request.post('/api/terminals', {
      headers: admin.headers,
      data: {
        name: 'E2E Kiosk',
        locationLabel: 'Testlabor',
        // companyId explizit: der geseedete Admin ist Super-Admin, für ihn wird
        // die eigene Firma beim Anlegen NICHT automatisch übernommen.
        companyId: admin.user.companyId,
        config: { methods: ['code'], requirePin: false },
      },
    });
    expect(created.status()).toBe(201);
    const { token, terminal } = await created.json();
    expect(token).toBeTruthy();
    expect(terminal.name).toBe('E2E Kiosk');

    // Stempel-Code des Mitarbeiters ermitteln.
    const users = (await (await request.get('/api/users', { headers: admin.headers })).json()).users;
    const lisa = users.find((u) => u.email === USERS.mitarbeiter.email);
    expect(lisa.stampCode).toMatch(/^\d{8}$/);

    // Kiosk-Setup
    await page.goto('/terminal');
    await expect(page.getByRole('heading', { name: 'Terminal einrichten' })).toBeVisible();
    await page.getByLabel('Geräte-Token').fill(token);
    await page.getByRole('button', { name: 'Verbinden', exact: true }).click();

    // Idle: nur Code-Eingabe (Terminal-Config methods=['code'])
    await expect(page.getByText('Stempel-Code eingeben')).toBeVisible();
    await expect(page.getByText('E2E Kiosk').first()).toBeVisible();

    // Kommen
    await enterCode(page, lisa.stampCode);
    await expect(page.getByText(`Hallo ${USERS.mitarbeiter.name}`)).toBeVisible();
    await page.getByRole('button', { name: 'Kommen', exact: true }).click();
    await expect(page.getByText('Eingestempelt', { exact: true })).toBeVisible();
    await expect(page.getByText(USERS.mitarbeiter.name)).toBeVisible();

    // Bestätigung antippen → zurück zum Idle-Screen
    await page.getByText('Eingestempelt', { exact: true }).click();
    await expect(page.getByText('Stempel-Code eingeben')).toBeVisible();

    // Gehen (Zustand ist jetzt „in" → Dialog bietet Gehen an)
    await enterCode(page, lisa.stampCode);
    await expect(page.getByText(`Hallo ${USERS.mitarbeiter.name}`)).toBeVisible();
    await page.getByRole('button', { name: 'Gehen', exact: true }).click();
    await expect(page.getByText('Ausgestempelt', { exact: true })).toBeVisible();
  });

  test('Unbekannter Code zeigt Fehlermeldung', async ({ page, request }) => {
    const admin = await login(request, 'admin');
    const created = await request.post('/api/terminals', {
      headers: admin.headers,
      data: { name: 'E2E Kiosk 2', companyId: admin.user.companyId, config: { methods: ['code'], requirePin: false } },
    });
    const { token } = await created.json();

    await page.goto('/terminal');
    await page.getByLabel('Geräte-Token').fill(token);
    await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
    await expect(page.getByText('Stempel-Code eingeben')).toBeVisible();

    await enterCode(page, '000');
    await expect(page.getByText('Code nicht erkannt — bitte erneut versuchen.')).toBeVisible();
  });

  test('Ungültiger Geräte-Token wird beim Setup abgelehnt', async ({ page }) => {
    await page.goto('/terminal');
    await page.getByLabel('Geräte-Token').fill('tft_ungueltig_1234567890');
    await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
    await expect(page.getByText('Token ungültig oder Terminal deaktiviert.')).toBeVisible();
  });
});
