// @ts-check
// Korrekturanträge: Mitarbeiter beantragt aus „Meine Zeiten", Verwaltung genehmigt,
// die vorgeschlagenen Stempel erscheinen als Nachbuchungen im Journal.
const { test, expect } = require('@playwright/test');
const {
  USERS, uiLogin, newRolePage, expectToast, ymd, hhmm, fmtDayCell,
} = require('./helpers');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Zwei garantiert vergangene HH:MM-Zeiten am heutigen Tag. */
function pastTimesToday() {
  const now = new Date();
  if (now.getHours() >= 4) return { t1: '03:05', t2: '03:20' };
  const a = new Date(now.getTime() - 20 * 60000);
  const b = new Date(now.getTime() - 10 * 60000);
  if (ymd(a) === ymd(now)) return { t1: hhmm(a), t2: hhmm(b) };
  return { t1: '00:01', t2: '00:03' };
}

test.describe('Korrekturanträge', () => {
  const { t1, t2 } = pastTimesToday();
  const MESSAGE = 'e2e: Stempelungen vergessen, bitte nachtragen';

  test('Mitarbeiter stellt Antrag, Verwaltung genehmigt, Stempel erscheinen', async ({ page, browser }) => {
    // --- Mitarbeiter: Antrag aus „Meine Zeiten" stellen ---
    await uiLogin(page, 'mitarbeiter');
    await page.goto('/times');

    const todayRow = page.getByRole('row', { name: new RegExp(esc(fmtDayCell(ymd()))) });
    await expect(todayRow).toBeVisible();
    await todayRow.getByRole('button', { name: 'Korrektur beantragen' }).click();

    await expect(page.getByText(/Korrektur beantragen —/)).toBeVisible();
    await page.getByLabel('Nachricht').fill(MESSAGE);

    // Zeile 1: Kommen (Default) um t1
    await page.getByLabel('Uhrzeit').first().fill(t1);
    // Zeile 2: Gehen um t2
    await page.getByRole('button', { name: 'Stempelung hinzufügen' }).click();
    await page.getByLabel('Typ').nth(1).selectOption({ label: 'Gehen' });
    await page.getByLabel('Uhrzeit').nth(1).fill(t2);

    await page.getByRole('button', { name: 'Antrag senden' }).click();
    await expectToast(page, 'Korrekturantrag gesendet.');

    // Eigene Anträge: Status „Offen"
    await page.getByRole('button', { name: 'Meine Korrekturanträge' }).click();
    await expect(page.getByText(MESSAGE)).toBeVisible();
    await expect(page.getByText('Offen', { exact: true }).first()).toBeVisible();

    // --- Verwaltung: genehmigen ---
    const v = await newRolePage(browser, 'verwaltung');
    await v.page.goto('/manage-times');
    await v.page.getByRole('button', { name: 'Korrekturanträge' }).click();

    const card = v.page.locator('.card').filter({ hasText: MESSAGE });
    await expect(card.getByText(USERS.mitarbeiter.name)).toBeVisible();
    await card.getByRole('button', { name: 'Genehmigen' }).click();

    await expect(v.page.getByText('Antrag genehmigen')).toBeVisible();
    await v.page.getByRole('button', { name: 'OK', exact: true }).click();
    await expectToast(v.page, 'Antrag genehmigt.');
    await v.context.close();

    // --- Mitarbeiter: Stempel erscheinen im Journal, Antrag ist genehmigt ---
    await page.reload();
    const rowAfter = page.getByRole('row', { name: new RegExp(esc(fmtDayCell(ymd()))) });
    await rowAfter.getByRole('button', { name: 'Stempelungen anzeigen' }).click();
    await expect(page.getByText(/Korrekturantrag #\d+/).first()).toBeVisible();
    await expect(page.locator('li').filter({ hasText: `${t1}:00` }).first()).toBeVisible();
    await expect(page.locator('li').filter({ hasText: `${t2}:00` }).first()).toBeVisible();

    await page.getByRole('button', { name: 'Meine Korrekturanträge' }).click();
    await expect(page.getByText('Genehmigt', { exact: true }).first()).toBeVisible();
  });
});
