// @ts-check
// Speicher-Einstellungen (Super-Admin): Abschnitt „Sekundärer S3", aktivieren mit
// Fantasie-Endpoint, „Sekundär testen" → saubere Fehlermeldung, Secrets maskiert
// (********), wieder deaktivieren.
const { test, expect } = require('@playwright/test');
const { login, uiLogin, expectToast } = require('./helpers');

const FAKE = {
  endpoint: 's3.e2e-fantasie.example.com',
  bucket: 'e2e-fake-bucket',
  accessKey: 'E2EFAKEACCESSKEY',
  secretKey: 'E2eFakeSecretKey123',
};

test.describe('Sekundärer S3-Speicher', () => {
  test('Aktivieren, Test schlägt sauber fehl, Secrets maskiert, deaktivieren', async ({ page, request }) => {
    test.slow(); // „Sekundär testen" wartet auf S3-Timeout/DNS-Fehler

    await uiLogin(page, 'admin'); // Seed-Admin ist Super-Admin
    await page.goto('/storage');
    await expect(page.getByRole('heading', { name: 'Speicher (S3)' })).toBeVisible();

    // Abschnitt „Sekundärer S3" ist sichtbar.
    const card = page.locator('.card').filter({
      has: page.getByRole('heading', { name: 'Sekundärer S3-Backup-Server' }),
    });
    await expect(card).toBeVisible();

    // Aktivieren → Felder erscheinen; Fantasie-Endpoint eintragen.
    await card.getByLabel('Sekundären S3 aktivieren').check();
    await card.getByPlaceholder('z.B. fsn1.your-objectstorage.com').fill(FAKE.endpoint);
    // Feld-Reihenfolge im Grid: Endpoint, Region, Bucket, Präfix, Access, Secret, Failover.
    await card.locator('input.input-field').nth(2).fill(FAKE.bucket);
    await card.locator('input[type="password"]').nth(0).fill(FAKE.accessKey);
    await card.locator('input[type="password"]').nth(1).fill(FAKE.secretKey);

    await card.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expectToast(page, 'Speichereinstellungen gespeichert');

    // „Sekundär testen" → Fehlermeldung (Toast), aber kein Crash.
    await card.getByRole('button', { name: 'Sekundär testen' }).click();
    await expect(
      page.getByText(/fehlgeschlagen|ENOTFOUND|getaddrinfo|erforderlich|not exist|error/i).first()
    ).toBeVisible({ timeout: 30000 });
    // Seite lebt noch (kein Crash/Blank).
    await expect(page.getByRole('heading', { name: 'Sekundärer S3-Backup-Server' })).toBeVisible();

    // API: Secrets kommen maskiert zurück, Klartext taucht nirgends auf.
    const admin = await login(request, 'admin');
    const stored = (await (await request.get('/api/storage', { headers: admin.headers })).json()).settings;
    expect(stored.secondaryEnabled).toBe(true);
    expect(stored.secondaryEndpoint).toBe(FAKE.endpoint);
    expect(stored.secondaryAccessKey).toBe('********');
    expect(stored.secondarySecretKey).toBe('********');
    expect(JSON.stringify(stored)).not.toContain(FAKE.secretKey);

    // Auch die UI zeigt nach Reload nur die Maske.
    await page.reload();
    await expect(card.locator('input[type="password"]').nth(0)).toHaveValue('********');

    // Wieder deaktivieren → API-Wert false.
    await card.getByLabel('Sekundären S3 aktivieren').uncheck();
    await card.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expectToast(page, 'Speichereinstellungen gespeichert');
    const after = (await (await request.get('/api/storage', { headers: admin.headers })).json()).settings;
    expect(after.secondaryEnabled).toBe(false);
  });
});
