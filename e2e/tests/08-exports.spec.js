// @ts-check
// Lohn-Export (Buchhaltung): Profil speichern, Vorschau, 409 bei offenem Monat,
// CSV-Download (BOM + PersonalNr-Kopfzeile).
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { USERS, login, uiLogin, expectToast, prevMonth } = require('./helpers');

test.describe('Lohn-Export', () => {
  const month = prevMonth(); // Seiten-Default ist der Vormonat

  test('Profil speichern, Vorschau lädt, Hinweis bei offenem Monat, CSV-Download', async ({ page, request }) => {
    await uiLogin(page, 'buchhaltung');
    await page.goto('/exports');
    await expect(page.getByRole('heading', { name: 'Lohn-Export' })).toBeVisible();

    // --- Exportprofil: Format CSV, nur abgeschlossene Monate ---
    await page.getByRole('button', { name: /Exportprofil/ }).click();
    await page.locator('label').filter({ hasText: 'Universelle Textdatei' }).click();
    await page
      .locator('label').filter({ hasText: 'Nur abgeschlossene Monate exportieren' })
      .getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Profil speichern' }).click();
    await expectToast(page, 'Exportprofil gespeichert');

    // --- Vorschau (Vormonat, aus Spec 07 mit Zeiten für Lisa Weber) ---
    await page.getByRole('button', { name: 'Vorschau', exact: true }).click();
    await expect(page.getByRole('cell', { name: USERS.mitarbeiter.name })).toBeVisible();
    await expect(page.getByText('Summe', { exact: true })).toBeVisible();

    // Hinweis: fehlende Personalnummer (Demo-Seeds haben keine)
    await expect(page.getByText(/keine Personalnummer hinterlegt/)).toBeVisible();

    // Roter Hinweis: Monat nicht abgeschlossen (wurde in Spec 07 wieder geöffnet)
    await expect(page.getByText('Monat nicht abgeschlossen')).toBeVisible();
    await expect(page.getByText('Trotzdem exportieren (force)')).toBeVisible();

    // --- API: Export ohne force → 409 MONTH_NOT_CLOSED ---
    const b = await login(request, 'buchhaltung');
    const run = await request.get(`/api/exports/run?month=${month}`, { headers: b.headers });
    expect(run.status()).toBe(409);
    const runBody = await run.json();
    expect(runBody.code).toBe('MONTH_NOT_CLOSED');
    expect(Array.isArray(runBody.openUsers)).toBeTruthy();

    // --- UI: force aktivieren und CSV herunterladen ---
    await page
      .locator('label').filter({ hasText: 'Trotzdem exportieren (force)' })
      .getByRole('checkbox').check();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export herunterladen' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.csv$/i);

    const filePath = await download.path();
    const content = fs.readFileSync(filePath, 'utf-8');
    // Dateiinhalt beginnt mit UTF-8-BOM und der PersonalNr-Kopfzeile.
    expect(content.charCodeAt(0)).toBe(0xfeff);
    expect(content.slice(1).startsWith('PersonalNr;Name;')).toBeTruthy();
    expect(content).toContain(USERS.mitarbeiter.name);

    await expectToast(page, 'Export heruntergeladen');
  });

  test('Vorschau per API liefert Zeilen und closedAll=false', async ({ request }) => {
    const b = await login(request, 'buchhaltung');
    const res = await request.get(`/api/exports/preview?month=${month}`, { headers: b.headers });
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.month).toBe(month);
    expect(body.rows.length).toBeGreaterThan(0);
    const lisa = body.rows.find((r) => r.name.includes('Weber'));
    expect(lisa).toBeTruthy();
    expect(lisa.istHours).toBeGreaterThan(0);
    expect(body.closedAll).toBe(false);
  });
});
