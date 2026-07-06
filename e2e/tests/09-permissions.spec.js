// @ts-check
// Rollen & Berechtigungen: Navigation je Rolle (Layout), Seiten-Guards, API-403-Checks.
// Rollenmodell laut Layout.tsx:
//   admin: alles · buchhaltung: verwalten/Mitarbeiter/Export (KEINE Terminals/
//   Zeitmodelle/Einstellungen) · verwaltung: verwalten (KEIN Export) · mitarbeiter: nur eigene Sicht.
const { test, expect } = require('@playwright/test');
const { login, uiLogin, newRolePage, prepPage, currentMonth } = require('./helpers');

const nav = (page) => page.getByRole('navigation');

test.describe('Berechtigungen: Navigation & Routen', () => {
  test('Mitarbeiter sieht keine Verwaltungs-Navigation', async ({ page }) => {
    await uiLogin(page, 'mitarbeiter');
    await page.goto('/dashboard');

    await expect(nav(page).getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(nav(page).getByRole('link', { name: 'Meine Zeiten' })).toBeVisible();

    for (const name of [
      'Zeiten verwalten', 'Anwesenheit', 'Mitarbeiter', 'Gruppen & Abteilungen',
      'Zeitmodelle', 'Terminals', 'Lohn-Export', 'API-Schlüssel', 'Einstellungen',
      'Firmen', 'Mandanten',
    ]) {
      await expect(nav(page).getByRole('link', { name })).toHaveCount(0);
    }
  });

  test('Mitarbeiter: geschützte Routen zeigen „Zugriff verweigert"', async ({ page }) => {
    await uiLogin(page, 'mitarbeiter');

    await page.goto('/time-models');
    await expect(page.getByText('Zugriff verweigert')).toBeVisible();
    await expect(page.getByText('Nur Administratoren können Zeitmodelle verwalten.')).toBeVisible();

    await page.goto('/exports');
    await expect(page.getByText('Nur Administratoren und Buchhaltung können Lohn-Exporte erstellen.')).toBeVisible();

    await page.goto('/terminals');
    await expect(page.getByText('Nur Administratoren können Terminals verwalten.')).toBeVisible();
  });

  test('Ohne Login: geschützte Route leitet auf /login um', async ({ page }) => {
    await prepPage(page);
    await page.goto('/manage-times');
    await page.waitForURL('**/login');
    await expect(page.getByRole('button', { name: 'Anmelden', exact: true })).toBeVisible();
  });

  test('Buchhaltung: verwalten/Export ja — Terminals/Zeitmodelle/Einstellungen nein', async ({ page }) => {
    await uiLogin(page, 'buchhaltung');
    await page.goto('/dashboard');

    for (const name of ['Zeiten verwalten', 'Mitarbeiter', 'Lohn-Export']) {
      await expect(nav(page).getByRole('link', { name })).toBeVisible();
    }
    for (const name of ['Zeitmodelle', 'Terminals', 'Einstellungen', 'API-Schlüssel']) {
      await expect(nav(page).getByRole('link', { name })).toHaveCount(0);
    }

    // Direktaufruf der Terminals-Verwaltung → Zugriff verweigert (nur Admin).
    await page.goto('/terminals');
    await expect(page.getByText('Nur Administratoren können Terminals verwalten.')).toBeVisible();
  });

  test('Verwaltung: verwalten ja — Lohn-Export/Zeitmodelle/Terminals nein', async ({ browser }) => {
    const v = await newRolePage(browser, 'verwaltung');
    await v.page.goto('/dashboard');

    await expect(nav(v.page).getByRole('link', { name: 'Zeiten verwalten' })).toBeVisible();
    for (const name of ['Lohn-Export', 'Zeitmodelle', 'Terminals', 'Einstellungen']) {
      await expect(nav(v.page).getByRole('link', { name })).toHaveCount(0);
    }
    await v.context.close();
  });
});

test.describe('Berechtigungen: API-403-Checks', () => {
  test('Mitarbeiter: Verwaltungs-Endpunkte → 403', async ({ request }) => {
    const m = await login(request, 'mitarbeiter');

    expect((await request.get('/api/time/month-overview', { headers: m.headers })).status()).toBe(403);
    expect((await request.get('/api/users', { headers: m.headers })).status()).toBe(403);
    expect((await request.get('/api/terminals', { headers: m.headers })).status()).toBe(403);
    expect((await request.get('/api/export-profile', { headers: m.headers })).status()).toBe(403);
    expect((await request.get('/api/time/presence', { headers: m.headers })).status()).toBe(403);

    const manual = await request.post('/api/time/manual', {
      headers: m.headers,
      data: { userId: m.user.id, type: 'in', timestamp: new Date(Date.now() - 3600000).toISOString() },
    });
    expect(manual.status()).toBe(403);

    // Keine Selbst-Eskalation der Rolle
    const escalate = await request.put(`/api/users/${m.user.id}`, {
      headers: m.headers,
      data: { role: 'admin' },
    });
    expect(escalate.status()).toBe(403);
  });

  test('Verwaltung: Abschluss/Export/Zeitmodelle → 403', async ({ request }) => {
    const v = await login(request, 'verwaltung');

    const close = await request.post('/api/time/close-month', {
      headers: v.headers,
      data: { month: currentMonth(), userId: v.user.id },
    });
    expect(close.status()).toBe(403);

    expect((await request.get('/api/export-profile', { headers: v.headers })).status()).toBe(403);
    expect((await request.get('/api/exports/preview?month=' + currentMonth(), { headers: v.headers })).status()).toBe(403);
    expect((await request.get('/api/terminals', { headers: v.headers })).status()).toBe(403);

    const model = await request.post('/api/time-models', {
      headers: v.headers,
      data: { name: 'e2e-verboten' },
    });
    expect(model.status()).toBe(403);
  });

  test('Buchhaltung: Wiedereröffnung/Zeitmodelle/Terminals → 403', async ({ request }) => {
    const b = await login(request, 'buchhaltung');

    const reopen = await request.post('/api/time/reopen-month', {
      headers: b.headers,
      data: { month: currentMonth(), userId: b.user.id },
    });
    expect(reopen.status()).toBe(403);

    const model = await request.post('/api/time-models', {
      headers: b.headers,
      data: { name: 'e2e-verboten' },
    });
    expect(model.status()).toBe(403);

    const terminal = await request.post('/api/terminals', {
      headers: b.headers,
      data: { name: 'e2e-verboten' },
    });
    expect(terminal.status()).toBe(403);
  });
});
