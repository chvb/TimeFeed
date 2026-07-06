// @ts-check
// Mitarbeiter: Dashboard-Stempeluhr (Kommen/Gehen), doppeltes Kommen, „Meine Zeiten".
const { test, expect } = require('@playwright/test');
const { uiLogin, expectToast, ymd, fmtDayCell } = require('./helpers');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('Stempeluhr (Dashboard)', () => {
  test('Kommen → Status wechselt → Gehen', async ({ page }) => {
    await uiLogin(page, 'mitarbeiter');
    await page.goto('/dashboard');

    await expect(page.getByText('Stempeluhr')).toBeVisible();
    await expect(page.getByText('Ausgestempelt', { exact: true })).toBeVisible();

    // Kommen
    await page.getByRole('button', { name: 'Kommen' }).click();
    await expectToast(page, 'Eingestempelt — guten Start!');
    await expect(page.getByText(/Eingestempelt seit \d{2}:\d{2}/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Gehen' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kommen' })).toHaveCount(0);

    // Tageskarte zeigt Werte
    await expect(page.getByText('Heute', { exact: true })).toBeVisible();
    await expect(page.getByText('Zeitkonto')).toBeVisible();

    // Gehen
    await page.getByRole('button', { name: 'Gehen' }).click();
    await expectToast(page, 'Ausgestempelt — Feierabend!');
    await expect(page.getByText('Ausgestempelt', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Kommen' })).toBeVisible();
  });

  test('Doppeltes Kommen zeigt Fehlermeldung', async ({ page }) => {
    const auth = await uiLogin(page, 'mitarbeiter');
    await page.goto('/dashboard');
    await expect(page.getByRole('button', { name: 'Kommen' })).toBeVisible();

    // Parallel (z. B. anderes Gerät) einstempeln → UI-Zustand ist veraltet.
    const apiIn = await page.request.post('/api/time/stamp', {
      headers: auth.headers,
      data: { type: 'in' },
    });
    expect(apiIn.status()).toBe(201);

    await page.getByRole('button', { name: 'Kommen' }).click();
    await expectToast(page, 'Sie sind bereits eingestempelt.');
    // UI lädt den Zustand neu → jetzt korrekt „eingestempelt".
    await expect(page.getByText(/Eingestempelt seit \d{2}:\d{2}/)).toBeVisible();

    // Aufräumen: wieder ausstempeln.
    const apiOut = await page.request.post('/api/time/stamp', {
      headers: auth.headers,
      data: { type: 'out' },
    });
    expect(apiOut.status()).toBe(201);
  });

  test('„Meine Zeiten" zeigt den heutigen Tag mit Monatssumme', async ({ page }) => {
    await uiLogin(page, 'mitarbeiter');
    await page.goto('/times');

    await expect(page.getByRole('heading', { name: 'Meine Zeiten' })).toBeVisible();

    const todayRow = page.getByRole('row', { name: new RegExp(esc(fmtDayCell(ymd()))) });
    await expect(todayRow).toBeVisible();

    await expect(page.getByText(/Monatssumme/).first()).toBeVisible();

    // Stempel-Journal des Tages aufklappen → Web-Stempel sichtbar.
    await todayRow.getByRole('button', { name: 'Stempelungen anzeigen' }).click();
    await expect(page.getByText('Stempelungen', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Web').first()).toBeVisible();
  });
});
