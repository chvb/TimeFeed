// @ts-check
// Monatsabschluss: Buchhaltung schließt den Vormonat (per API vorbereitete saubere
// Tage), UI zeigt die Sperre, Nachbuchen wird mit 423 abgelehnt, Admin öffnet wieder.
const { test, expect } = require('@playwright/test');
const {
  USERS, login, uiLogin, newRolePage, expectToast, prevMonth,
} = require('./helpers');

test.describe('Monatsabschluss', () => {
  const month = prevMonth();

  test('Schließen (UI) → Sperre → 423 → Wiedereröffnung (Admin)', async ({ page, request, browser }) => {
    const admin = await login(request, 'admin');
    const users = (await (await request.get('/api/users', { headers: admin.headers })).json()).users;
    const lisa = users.find((u) => u.email === USERS.mitarbeiter.email);

    const manual = (day, time, type) => request.post('/api/time/manual', {
      headers: admin.headers,
      data: {
        userId: lisa.id,
        type,
        timestamp: new Date(`${month}-${day}T${time}:00`).toISOString(),
        note: 'e2e Vorbereitung Monatsabschluss',
      },
    });

    // Sauberer Tag im Vormonat: vollständiges Kommen/Gehen-Paar.
    expect((await manual('15', '09:00', 'in')).status()).toBe(201);
    expect((await manual('15', '17:00', 'out')).status()).toBe(201);

    // --- Buchhaltung schließt den Vormonat über die UI ---
    await uiLogin(page, 'buchhaltung');
    await page.goto('/manage-times');
    await page.locator('#manage-month-picker').fill(month);

    const row = page.getByRole('row', { name: new RegExp(USERS.mitarbeiter.name) });
    await expect(row).toBeVisible();
    await row.click();

    await page.getByRole('button', { name: 'Monat abschließen' }).click();
    await page.getByRole('button', { name: 'Bestätigen', exact: true }).click();
    await expectToast(page, 'Monat abgeschlossen.');

    // UI zeigt die Sperre
    await expect(page.getByText('Dieser Monat ist abgeschlossen. Buchungen sind gesperrt.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nachbuchen' })).toBeDisabled();

    // Übersicht zeigt das Abgeschlossen-Badge
    await page.getByRole('button', { name: 'Zurück zur Übersicht' }).click();
    await expect(
      page.getByRole('row', { name: new RegExp(USERS.mitarbeiter.name) }).getByText('Abgeschlossen')
    ).toBeVisible();

    // --- Nachbuchen im gesperrten Monat → 423 MONTH_LOCKED ---
    const blocked = await manual('16', '09:00', 'in');
    expect(blocked.status()).toBe(423);
    expect((await blocked.json()).code).toBe('MONTH_LOCKED');

    // Auch der Mitarbeiter kann keinen Korrekturantrag für den Monat stellen.
    const emp = await login(request, 'mitarbeiter');
    const corr = await request.post('/api/corrections', {
      headers: emp.headers,
      data: { date: `${month}-15`, message: 'e2e', proposedEntries: [{ type: 'in', time: '08:00' }] },
    });
    expect(corr.status()).toBe(423);

    // --- Admin öffnet den Monat wieder (UI) ---
    const a = await newRolePage(browser, 'admin');
    await a.page.goto('/manage-times');
    await a.page.locator('#manage-month-picker').fill(month);
    await a.page.getByRole('row', { name: new RegExp(USERS.mitarbeiter.name) }).click();
    await a.page.getByRole('button', { name: 'Wieder öffnen' }).click();
    await a.page.getByRole('button', { name: 'Bestätigen', exact: true }).click();
    await expectToast(a.page, 'Monat wieder geöffnet.');
    await a.context.close();

    // Nachbuchen funktioniert wieder (vollständiges Paar, Monat bleibt sauber).
    expect((await manual('16', '09:00', 'in')).status()).toBe(201);
    expect((await manual('16', '10:00', 'out')).status()).toBe(201);
  });
});
