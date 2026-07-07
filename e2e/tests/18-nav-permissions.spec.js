// @ts-check
// Navigation & Berechtigungen (v1.1.0): Dashboard steht über Feed; „API-Schlüssel"
// nur für Super-Admins sichtbar (unter „Einstellungen"); normaler Firmen-Admin
// sieht den Punkt nicht und bekommt auf /api-keys „Kein Zugriff".
const { test, expect } = require('@playwright/test');
const { login, uiLogin } = require('./helpers');

const NAV_ADMIN = { email: 'e2e-nav-admin@timefeed.de', password: 'E2eNavAdmin_123!' };
const nav = (page) => page.getByRole('navigation');

async function navTexts(page) {
  const texts = await nav(page).getByRole('link').allInnerTexts();
  return texts.map((t) => t.trim()).filter(Boolean);
}

test.describe('Navigation & API-Schlüssel-Berechtigung', () => {
  test('Super-Admin: Dashboard über Feed, „API-Schlüssel" unter „Einstellungen"', async ({ page }) => {
    await uiLogin(page, 'admin'); // Seed-Admin IST Super-Admin
    await page.goto('/dashboard');
    await expect(nav(page).getByRole('link', { name: 'API-Schlüssel' })).toBeVisible();

    const texts = await navTexts(page);
    expect(texts.indexOf('Dashboard')).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf('Dashboard')).toBeLessThan(texts.indexOf('Feed'));
    // „API-Schlüssel" folgt direkt auf „Einstellungen".
    const idxSettings = texts.indexOf('Einstellungen');
    expect(idxSettings).toBeGreaterThanOrEqual(0);
    expect(texts[idxSettings + 1]).toBe('API-Schlüssel');

    // Seite ist für den Super-Admin erreichbar.
    await page.goto('/api-keys');
    await expect(page.getByRole('heading', { name: 'API-Schlüssel' })).toBeVisible();
    await expect(page.getByText('Kein Zugriff auf die API-Schlüssel-Verwaltung.')).toHaveCount(0);
  });

  test('Mitarbeiter: Dashboard über Feed, kein „API-Schlüssel"', async ({ page }) => {
    await uiLogin(page, 'mitarbeiter');
    await page.goto('/dashboard');
    await expect(nav(page).getByRole('link', { name: 'Feed' })).toBeVisible();

    const texts = await navTexts(page);
    expect(texts.indexOf('Dashboard')).toBeLessThan(texts.indexOf('Feed'));
    expect(texts).not.toContain('API-Schlüssel');
  });

  test('Admin ohne Super-Admin-Flag: kein Nav-Punkt, /api-keys → „Kein Zugriff", API → 403', async ({ page, request }) => {
    const admin = await login(request, 'admin');
    const created = await request.post('/api/users', {
      headers: admin.headers,
      data: {
        email: NAV_ADMIN.email, password: NAV_ADMIN.password,
        firstName: 'Norman', lastName: 'Navadmin', role: 'admin',
        companyId: admin.user.companyId,
      },
    });
    expect([201, 400]).toContain(created.status()); // 400 = existiert bereits

    await uiLogin(page, NAV_ADMIN);
    await page.goto('/dashboard');
    await expect(nav(page).getByRole('link', { name: 'Einstellungen' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'API-Schlüssel' })).toHaveCount(0);

    // Direktaufruf → Kein Zugriff.
    await page.goto('/api-keys');
    await expect(page.getByText('Kein Zugriff auf die API-Schlüssel-Verwaltung.')).toBeVisible();

    // API-Ebene: 403 für Nicht-Super-Admins.
    const navAdmin = await login(request, NAV_ADMIN);
    expect((await request.get('/api/api-keys', { headers: navAdmin.headers })).status()).toBe(403);
  });
});
