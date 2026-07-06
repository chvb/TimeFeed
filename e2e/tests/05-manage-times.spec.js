// @ts-check
// Verwaltung: Nachbuchen per UI, Storno mit Begründung, Monatsübersicht zeigt Werte.
// Ziel-Mitarbeiter ist der Verwalter selbst (Thomas Müller, Manager der Gruppe
// „Entwicklung") — so bleiben Lisas Stempel-Zustände für andere Specs unberührt.
const { test, expect } = require('@playwright/test');
const { USERS, uiLogin, expectToast, pastSlotInCurrentMonth } = require('./helpers');

const slot = pastSlotInCurrentMonth();

/** Erwartete Ist-Zeit zwischen t1 und t2 als "H:MM h" (formatMinutes). */
function expectedWorked() {
  const [h1, m1] = slot.t1.split(':').map(Number);
  const [h2, m2] = slot.t2.split(':').map(Number);
  const min = h2 * 60 + m2 - (h1 * 60 + m1);
  return `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} h`;
}

async function openDetail(page) {
  await page.goto('/manage-times');
  await expect(page.getByRole('heading', { name: 'Zeiten verwalten' })).toBeVisible();
  const row = page.getByRole('row', { name: new RegExp(USERS.verwaltung.name) });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByRole('button', { name: 'Nachbuchen' })).toBeVisible();
}

async function bookManual(page, { time, typeLabel }) {
  await page.getByRole('button', { name: 'Nachbuchen' }).click();
  await expect(page.getByText('Stempelung nachbuchen')).toBeVisible();
  await page.getByLabel('Datum').fill(slot.date);
  await page.getByLabel('Uhrzeit').fill(time);
  await page.getByLabel('Typ').selectOption({ label: typeLabel });
  // Nicht getByLabel('Notiz'): der Stundenzettel-Bereich der Detailseite hat
  // ebenfalls ein „Notiz"-Feld → gezielt das Feld des Nachbuchen-Modals.
  await page.locator('#manual-note').fill('e2e Nachbuchung');
  await page.getByRole('button', { name: 'Buchen', exact: true }).click();
  await expectToast(page, 'Stempelung nachgebucht.');
  await expect(page.getByText('Stempelung nachbuchen')).toBeHidden();
}

test.describe('Zeiten verwalten', () => {
  test('Nachbuchen per UI (Kommen + Gehen)', async ({ page }) => {
    await uiLogin(page, 'verwaltung');
    await openDetail(page);

    await bookManual(page, { time: slot.t1, typeLabel: 'Kommen' });
    await bookManual(page, { time: slot.t2, typeLabel: 'Gehen' });

    // Tag aufklappen → Journal zeigt beide Nachbuchungen.
    const dayRow = page.getByRole('row').filter({ hasText: slot.t1 }).first();
    await expect(dayRow).toBeVisible();
    await dayRow.click();
    await expect(page.getByText('Stempelungen', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Nachbuchung').first()).toBeVisible();
    await expect(page.getByText(`${slot.t1}:00`).first()).toBeVisible();
    await expect(page.getByText(`${slot.t2}:00`).first()).toBeVisible();
  });

  test('Monatsübersicht zeigt Werte des nachgebuchten Tags', async ({ page }) => {
    await uiLogin(page, 'verwaltung');
    await page.goto('/manage-times');

    const row = page.getByRole('row', { name: new RegExp(USERS.verwaltung.name) });
    await expect(row).toBeVisible();
    // Ist-Spalte enthält die nachgebuchte Zeitspanne (z. B. "1:00 h").
    await expect(row.getByText(expectedWorked())).toBeVisible();
  });

  test('Storno mit Begründung', async ({ page }) => {
    await uiLogin(page, 'verwaltung');
    await openDetail(page);

    const dayRow = page.getByRole('row').filter({ hasText: slot.t1 }).first();
    await dayRow.click();

    // Gehen-Stempel stornieren
    const outEntry = page.locator('li').filter({ hasText: `${slot.t2}:00` }).first();
    await outEntry.getByRole('button', { name: 'Stornieren' }).click();

    await expect(page.getByText('Stempelung stornieren')).toBeVisible();
    await page.getByPlaceholder('Begründung (Pflicht)').fill('e2e Storno-Test');
    await page.getByRole('button', { name: 'OK', exact: true }).click();

    await expectToast(page, 'Stempelung storniert.');
    await expect(page.getByText('Storniert: e2e Storno-Test').first()).toBeVisible();
  });
});
