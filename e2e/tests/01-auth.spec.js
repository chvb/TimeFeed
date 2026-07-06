// @ts-check
// Auth: Login/Logout über die UI, falsches Passwort, Passwort-Policy-Basics (API).
const { test, expect } = require('@playwright/test');
const { USERS, login, uiLogin, prepPage, expectToast } = require('./helpers');

test.describe('Auth: Login/Logout', () => {
  test('Login über das Formular führt zum Dashboard', async ({ page }) => {
    await prepPage(page);
    await page.goto('/login');
    await expect(page.getByRole('heading', { name: 'TimeFeed' })).toBeVisible();

    await page.getByPlaceholder('name@firma.de').fill(USERS.mitarbeiter.email);
    await page.getByPlaceholder('••••••••').fill(USERS.mitarbeiter.password);
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

    await page.waitForURL('**/dashboard');
    await expect(page.getByText('Stempeluhr')).toBeVisible();
    await expect(page.getByText(USERS.mitarbeiter.name).first()).toBeVisible();
  });

  test('Falsches Passwort zeigt Fehlermeldung und bleibt auf /login', async ({ page }) => {
    await prepPage(page);
    await page.goto('/login');
    await page.getByPlaceholder('name@firma.de').fill(USERS.mitarbeiter.email);
    await page.getByPlaceholder('••••••••').fill('Definitiv-Falsch-123!');
    await page.getByRole('button', { name: 'Anmelden', exact: true }).click();

    await expectToast(page, 'E-Mail oder Passwort ist falsch.');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('Logout über das Benutzermenü', async ({ page }) => {
    await uiLogin(page, 'admin');
    await page.goto('/dashboard');
    await expect(page.getByText('Stempeluhr')).toBeVisible();

    await page.getByRole('button', { name: USERS.admin.name }).click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();

    await page.waitForURL('**/login');
    await expectToast(page, 'Erfolgreich abgemeldet');
  });
});

test.describe('Auth: Passwort-Policy (API)', () => {
  test('Zu kurzes/zu einfaches neues Passwort wird abgelehnt', async ({ request }) => {
    const me = await login(request, 'mitarbeiter');

    // Zu kurz
    const short = await request.post('/api/auth/change-password', {
      headers: me.headers,
      data: { currentPassword: USERS.mitarbeiter.password, newPassword: 'Ab1!' },
    });
    expect(short.status()).toBe(400);
    const shortBody = await short.json();
    expect(JSON.stringify(shortBody.errors)).toContain('mindestens 8 Zeichen');

    // Ohne Zahl/Sonderzeichen
    const simple = await request.post('/api/auth/change-password', {
      headers: me.headers,
      data: { currentPassword: USERS.mitarbeiter.password, newPassword: 'nurbuchstaben' },
    });
    expect(simple.status()).toBe(400);
  });

  test('Falsches aktuelles Passwort → 401 (Passwort bleibt unverändert)', async ({ request }) => {
    const me = await login(request, 'mitarbeiter');
    const res = await request.post('/api/auth/change-password', {
      headers: me.headers,
      data: { currentPassword: 'Falsches-Passwort-1!', newPassword: 'Neues-Passwort-123!' },
    });
    expect(res.status()).toBe(401);

    // Login mit dem ursprünglichen Passwort funktioniert weiterhin.
    const again = await request.post('/api/auth/login', {
      data: { email: USERS.mitarbeiter.email, password: USERS.mitarbeiter.password },
    });
    expect(again.ok()).toBeTruthy();
  });

  test('GET /api/auth/me ohne Token → 401', async ({ request }) => {
    const res = await request.get('/api/auth/me');
    expect(res.status()).toBe(401);
  });
});
