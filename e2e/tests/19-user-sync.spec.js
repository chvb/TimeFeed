// @ts-check
// Mitarbeiter-Abgleich UrlaubsFeed → TimeFeed (Einstellungen → Tab „Integrationen"):
// Die Gegenstelle wird per page.route gemockt (GET …/urlaubsfeed/users bzw.
// POST …/urlaubsfeed/import-users), Shapes laut server/src/controllers/
// integration.controller.ts. Dazu API-Tests für API-Key-Scopes (times:read +
// users:read) und den externen Mitarbeiter-Export /api/external/users.
const { test, expect } = require('@playwright/test');
const { login, uiLogin, expectToast } = require('./helpers');

// Gemockte Remote-Liste: 2 neue, 1 vorhandener (Seed-Lisa), 1 abweichender (Seed-Thomas).
const REMOTE_USERS = [
  { firstName: 'Nora', lastName: 'Neumann', email: 'nora.neumann@uf-extern.de', employeeNumber: 'UF-001', groupName: 'Vertrieb', status: 'new' },
  { firstName: 'Nils', lastName: 'Neuling', email: 'nils.neuling@uf-extern.de', employeeNumber: null, groupName: null, status: 'new' },
  { firstName: 'Lisa', lastName: 'Weber', email: 'mitarbeiter@timefeed.de', employeeNumber: 'PN-100', groupName: 'Entwicklung', status: 'exists' },
  { firstName: 'Thomas', lastName: 'Mueller', email: 'verwaltung@timefeed.de', employeeNumber: 'PN-200', groupName: 'Entwicklung', status: 'diff', diff: { lastName: 'Mueller', employeeNumber: 'PN-200' } },
];
const NEW_EMAILS = REMOTE_USERS.filter((u) => u.status === 'new').map((u) => u.email);

/**
 * Integrations-Settings idempotent per API setzen: Der „Laden"-Button ist erst
 * aktiv, wenn URL + API-Key hinterlegt sind (hasKey). Die Fantasie-URL wird nie
 * kontaktiert — die Remote-Aufrufe sind in den UI-Tests komplett gemockt.
 */
async function ensureUfConfigured(request) {
  const admin = await login(request, 'admin');
  const res = await request.put('/api/integrations/urlaubsfeed', {
    headers: admin.headers,
    data: { urlaubsfeedUrl: 'https://urlaubsfeed.e2e-fantasie.example.com', urlaubsfeedApiKey: 'e2e-uf-dummy-key' },
  });
  expect(res.ok()).toBeTruthy();
  return admin;
}

/** GET …/urlaubsfeed/users mocken (Antwort-Shape wie listRemoteUsers). */
async function mockRemoteUsers(page, users = REMOTE_USERS) {
  await page.route('**/api/integrations/urlaubsfeed/users*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ users }) })
  );
}

/** Zum Abschnitt „Mitarbeiter-Abgleich" navigieren (Seed-Admin = Firmen-/Super-Admin). */
async function openUserSync(page) {
  await uiLogin(page, 'admin');
  await page.goto('/settings?tab=integrations');
  await expect(page.getByRole('heading', { name: 'Mitarbeiter-Abgleich' })).toBeVisible();
  const loadBtn = page.getByRole('button', { name: 'Mitarbeiter aus UrlaubsFeed laden' });
  await expect(loadBtn).toBeEnabled(); // hasKey wurde asynchron geladen
  return loadBtn;
}

const rowFor = (page, email) => page.locator('tbody tr').filter({ hasText: email });

test.describe('Mitarbeiter-Abgleich (UrlaubsFeed → TimeFeed)', () => {
  test('Laden: Tabelle mit Status-Badges, „Neu" vorausgewählt, Kopf-Checkbox toggelt alle', async ({ page, request }) => {
    await ensureUfConfigured(request);
    await mockRemoteUsers(page);
    const loadBtn = await openUserSync(page);

    await loadBtn.click();
    await expect(page.locator('tbody tr')).toHaveCount(4);

    // Status-Badges: 2× Neu, 1× Vorhanden, 1× Abweichend.
    await expect(page.locator('tbody').getByText('Neu', { exact: true })).toHaveCount(2);
    await expect(page.locator('tbody').getByText('Vorhanden', { exact: true })).toHaveCount(1);
    await expect(page.locator('tbody').getByText('Abweichend', { exact: true })).toHaveCount(1);

    // Nur die „Neu"-Zeilen sind vorausgewählt.
    await expect(page.getByText('2 ausgewählt')).toBeVisible();
    for (const email of NEW_EMAILS) {
      await expect(rowFor(page, email).getByRole('checkbox')).toBeChecked();
    }
    await expect(rowFor(page, 'mitarbeiter@timefeed.de').getByRole('checkbox')).not.toBeChecked();
    await expect(rowFor(page, 'verwaltung@timefeed.de').getByRole('checkbox')).not.toBeChecked();

    // Kopf-Checkbox: alle an → alle aus.
    const headCheckbox = page.locator('thead').getByRole('checkbox');
    await headCheckbox.click();
    await expect(page.getByText('4 ausgewählt')).toBeVisible();
    for (const u of REMOTE_USERS) {
      await expect(rowFor(page, u.email).getByRole('checkbox')).toBeChecked();
    }
    await headCheckbox.click();
    await expect(page.getByText('0 ausgewählt')).toBeVisible();
    for (const u of REMOTE_USERS) {
      await expect(rowFor(page, u.email).getByRole('checkbox')).not.toBeChecked();
    }
  });

  test('Import-Flow: Confirm-Dialog, Ergebnis + Toast, POST-Body mit gewählten E-Mails und Flags', async ({ page, request }) => {
    await ensureUfConfigured(request);
    await mockRemoteUsers(page);

    /** @type {any} */
    let importBody = null;
    await page.route('**/api/integrations/urlaubsfeed/import-users', (route) => {
      importBody = route.request().postDataJSON();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ created: 2, updated: 0, skipped: 1, errors: [] }),
      });
    });

    const loadBtn = await openUserSync(page);
    await loadBtn.click();
    await expect(page.getByText('2 ausgewählt')).toBeVisible();

    // Zusätzlich die vorhandene Lisa anwählen (→ 3) und „Vorhandene aktualisieren" setzen.
    await rowFor(page, 'mitarbeiter@timefeed.de').getByRole('checkbox').check();
    await expect(page.getByText('3 ausgewählt')).toBeVisible();
    await page.locator('#uf-update-existing').check();

    // Import → Confirm-Dialog mit Anzahl.
    await page.getByRole('button', { name: 'Auswahl importieren (3)' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText('Mitarbeiter importieren')).toBeVisible();
    await expect(dialog.getByText('3 Mitarbeiter jetzt aus UrlaubsFeed importieren?')).toBeVisible();
    await dialog.getByRole('button', { name: 'Importieren', exact: true }).click();

    // Erfolgs-Toast + Ergebnis-Zusammenfassung.
    await expectToast(page, 'Import abgeschlossen: 2 angelegt, 0 aktualisiert');
    await expect(page.getByText('Import-Ergebnis')).toBeVisible();
    await expect(page.getByText('2 angelegt').first()).toBeVisible();
    await expect(page.getByText('1 übersprungen')).toBeVisible();

    // POST-Body: genau die gewählten E-Mails + Flags (Seed-Admin hat eine Firma → kein companyId nötig).
    expect(importBody).not.toBeNull();
    expect([...importBody.emails].sort()).toEqual(
      [...NEW_EMAILS, 'mitarbeiter@timefeed.de'].map((e) => e.toLowerCase()).sort()
    );
    expect(importBody.updateExisting).toBe(true);
    expect(importBody.sendWelcome).toBe(false);
  });

  test('Fehlerpfad: 502 der Gegenstelle → Fehlermeldung, kein Crash', async ({ page, request }) => {
    await ensureUfConfigured(request);
    await page.route('**/api/integrations/urlaubsfeed/users*', (route) =>
      route.fulfill({
        status: 502,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'UrlaubsFeed nicht erreichbar: ECONNREFUSED' }),
      })
    );

    const loadBtn = await openUserSync(page);
    await loadBtn.click();

    // Fehler-Toast mit Detail der Gegenstelle; keine Tabelle.
    await expectToast(page, 'UrlaubsFeed nicht erreichbar: ECONNREFUSED');
    await expect(page.locator('tbody tr')).toHaveCount(0);

    // Seite lebt noch, Button wieder bedienbar.
    await expect(page.getByRole('heading', { name: 'Mitarbeiter-Abgleich' })).toBeVisible();
    await expect(loadBtn).toBeEnabled();
  });
});

test.describe('API-Key-Scopes & externer Mitarbeiter-Export', () => {
  /** Vollschlüssel aus Test „API-Key-Scopes" für den Folgetest (workers=1, keine Retries). */
  let externalKey = null;

  async function createApiKey(request) {
    const admin = await login(request, 'admin'); // Seed-Admin ist Super-Admin
    const tenants = (await (await request.get('/api/tenants', { headers: admin.headers })).json()).tenants;
    expect(Array.isArray(tenants)).toBeTruthy();
    expect(tenants.length).toBeGreaterThan(0);
    const res = await request.post('/api/api-keys', {
      headers: admin.headers,
      data: { name: `E2E User-Sync ${Date.now()}`, tenantId: tenants[0].id },
    });
    expect(res.status()).toBe(201);
    return res.json();
  }

  test('Neuer API-Key enthält die Scopes times:read UND users:read', async ({ request }) => {
    const body = await createApiKey(request);
    expect(typeof body.key).toBe('string');
    expect(body.key.length).toBeGreaterThan(20);
    expect(body.apiKey.scopes).toContain('times:read');
    expect(body.apiKey.scopes).toContain('users:read');
    expect(body.apiKey.isActive).toBe(true);
    externalKey = body.key;
  });

  test('GET /api/external/users: 200 mit Stammdaten (ohne Geheimnisse), ohne Key 401', async ({ request }) => {
    if (!externalKey) externalKey = (await createApiKey(request)).key; // Fallback bei Einzelausführung

    const res = await request.get('/api/external/users', { headers: { 'X-Api-Key': externalKey } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.users)).toBeTruthy();
    expect(body.users.length).toBeGreaterThanOrEqual(4); // mindestens die Seed-User

    const emails = body.users.map((u) => u.email);
    expect(emails).toContain('admin@timefeed.de');
    expect(emails).toContain('mitarbeiter@timefeed.de');

    // Nur Stammdaten — keine Geheimnisse (password/pin/stampCode) und keine IDs.
    for (const u of body.users) {
      expect(u).toHaveProperty('firstName');
      expect(u).toHaveProperty('lastName');
      expect(u).toHaveProperty('email');
      expect(u).not.toHaveProperty('password');
      expect(u).not.toHaveProperty('pin');
      expect(u).not.toHaveProperty('stampCode');
      expect(u).not.toHaveProperty('id');
    }
    expect(JSON.stringify(body)).not.toMatch(/password|stampCode/);

    // Ohne Key → 401.
    expect((await request.get('/api/external/users')).status()).toBe(401);
  });
});
