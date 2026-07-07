// @ts-check
// Terminal-Features (v1.1.0): passwortgeschützte Kiosk-Einstellungen, Tastatur-/
// Scanner-Eingabe des Stempel-Codes am Idle-Screen, Token-Neuerzeugung mit
// tokenInvalid-Banner (Terminal bleibt angemeldet).
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

const SETTINGS_PASSWORD = 'e2e-Kiosk-Geheim';

/** Terminal per API anlegen → { terminal, token }. */
async function createTerminal(request, admin, data) {
  const res = await request.post('/api/terminals', {
    headers: admin.headers,
    data: { companyId: admin.user.companyId, config: { methods: ['code'], requirePin: false }, ...data },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

/** Eigener Kiosk-Mitarbeiter je Spec (Stempel-Zustände anderer Specs unberührt). */
async function ensureKioskUser(request, admin) {
  const email = 'e2e-kiosk-karla@timefeed.de';
  const created = await request.post('/api/users', {
    headers: admin.headers,
    data: {
      email,
      password: 'E2eKioskKarla_123!',
      firstName: 'Karla',
      lastName: 'Kiosk',
      role: 'mitarbeiter',
      companyId: admin.user.companyId,
    },
  });
  expect([201, 400]).toContain(created.status()); // 400 = existiert bereits
  const users = (await (await request.get('/api/users', { headers: admin.headers })).json()).users;
  const user = users.find((u) => u.email === email);
  expect(user, 'Kiosk-Testuser muss existieren').toBeTruthy();
  expect(user.stampCode).toMatch(/^\d{8}$/);
  return user;
}

/** Kiosk verbinden bis zum Idle-Screen. */
async function connectKiosk(page, token) {
  await page.goto('/terminal');
  await expect(page.getByRole('heading', { name: 'Terminal einrichten' })).toBeVisible();
  await page.getByLabel('Geräte-Token').fill(token);
  await page.getByRole('button', { name: 'Verbinden', exact: true }).click();
  await expect(page.getByText('Stempel-Code eingeben')).toBeVisible();
}

test.describe('Terminal-Features (Kiosk)', () => {
  test('Einstellungs-Passwort: Gate, falsches Passwort, Entsperren', async ({ page, request }) => {
    const admin = await login(request, 'admin');
    const { token } = await createTerminal(request, admin, {
      name: 'E2E Kiosk Gate',
      settingsPassword: SETTINGS_PASSWORD,
    });

    await connectKiosk(page, token);

    // Zahnrad → Passwort-Gate statt direktem Setup.
    await page.getByRole('button', { name: 'Terminal einrichten' }).click();
    await expect(page.getByRole('heading', { name: 'Einstellungen geschützt' })).toBeVisible();
    await expect(page.getByText('Bitte das Einstellungs-Passwort dieses Terminals eingeben.')).toBeVisible();

    // Falsches Passwort → Fehlermeldung mit Restversuchen.
    await page.getByLabel('Einstellungs-Passwort').fill('voellig-falsch');
    await page.getByRole('button', { name: 'Entsperren', exact: true }).click();
    await expect(page.getByText('Passwort falsch — noch 2 Versuch(e).')).toBeVisible();

    // Richtiges Passwort → Setup-Screen sichtbar.
    await page.getByLabel('Einstellungs-Passwort').fill(SETTINGS_PASSWORD);
    await page.getByRole('button', { name: 'Entsperren', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Terminal einrichten' })).toBeVisible();
    await expect(page.getByLabel('Geräte-Token')).toBeVisible();

    // Zurück zum Idle-Screen — Terminal bleibt verbunden.
    await page.getByRole('button', { name: 'Zurück', exact: true }).click();
    await expect(page.getByText('Stempel-Code eingeben')).toBeVisible();
  });

  test('Tastatur-Eingabe des Stempel-Codes am Idle-Screen', async ({ page, request }) => {
    const admin = await login(request, 'admin');
    const user = await ensureKioskUser(request, admin);
    const { token } = await createTerminal(request, admin, { name: 'E2E Kiosk Tastatur' });

    await connectKiosk(page, token);

    // Kommen: Code über die physische Tastatur (Scanner-Emulation) + Enter.
    await page.keyboard.type(user.stampCode);
    await page.keyboard.press('Enter');
    await expect(page.getByText(`Hallo ${user.firstName} ${user.lastName}`)).toBeVisible();
    await expect(page.getByText('Bitte Aktion wählen')).toBeVisible();
    await page.getByRole('button', { name: 'Kommen', exact: true }).click();
    await expect(page.getByText('Eingestempelt', { exact: true })).toBeVisible();

    // Bestätigung antippen → Idle, dann Gehen (Zustand sauber hinterlassen).
    await page.getByText('Eingestempelt', { exact: true }).click();
    await expect(page.getByText('Stempel-Code eingeben')).toBeVisible();
    await page.keyboard.type(user.stampCode);
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: 'Gehen', exact: true }).click();
    await expect(page.getByText('Ausgestempelt', { exact: true })).toBeVisible();
  });

  test('Token-Neuerzeugung: Kiosk zeigt Banner, bleibt aber angemeldet', async ({ page, request }) => {
    const admin = await login(request, 'admin');
    const { terminal, token } = await createTerminal(request, admin, { name: 'E2E Kiosk Regenerate' });

    await connectKiosk(page, token);

    // Admin erzeugt ein neues Token → altes ist sofort ungültig.
    const regen = await request.post(`/api/terminals/${terminal.id}/regenerate-token`, {
      headers: admin.headers,
    });
    expect(regen.status()).toBe(200);
    const regenBody = await regen.json();
    expect(regenBody.token).toBeTruthy();
    expect(regenBody.token).not.toBe(token);

    // Altes Token wird vom Server abgelehnt (Ping → 401 TERMINAL_TOKEN_INVALID).
    const ping = await request.get('/api/terminal/ping', {
      headers: { 'X-Terminal-Token': token },
    });
    expect(ping.status()).toBe(401);
    expect((await ping.json()).code).toBe('TERMINAL_TOKEN_INVALID');

    // Reload → Kiosk erkennt das ungültige Token und zeigt den Banner …
    await page.reload();
    await expect(
      page.getByText(/Geräte-Token wird vom Server abgelehnt/)
    ).toBeVisible();

    // … bleibt aber angemeldet: Idle-Screen weiter da, Token noch im localStorage.
    await expect(page.getByText('Stempel-Code eingeben')).toBeVisible();
    const stored = await page.evaluate(() => localStorage.getItem('tf-terminal-token'));
    expect(stored).toBe(token);
  });
});
