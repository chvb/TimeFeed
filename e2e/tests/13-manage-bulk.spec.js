// @ts-check
// Sammel-Monatsabschluss (v1.1.0): INCOMPLETE_DAYS-Hinweisbox bei offenem Stempel,
// „Monat für alle abschließen" (Buchhaltung) mit Badges, „Für alle wieder öffnen"
// (nur Admin). Vormonatsdaten werden per API sauber vorbereitet.
const { test, expect } = require('@playwright/test');
const {
  USERS, login, uiLogin, newRolePage, expectToast, prevMonth,
} = require('./helpers');

test.describe('Sammel-Monatsabschluss', () => {
  const month = prevMonth();

  test('Hinweisbox bei offenem Stempel → Abschluss für alle → Wiedereröffnung', async ({ page, request, browser }) => {
    const admin = await login(request, 'admin');
    const users = (await (await request.get('/api/users', { headers: admin.headers })).json()).users;
    const lisa = users.find((u) => u.email === USERS.mitarbeiter.email);

    // Falls ein früherer Lauf den Monat geschlossen hinterlassen hat: best effort öffnen.
    await request.post('/api/time/reopen-month', { headers: admin.headers, data: { month } });
    await request.post('/api/time/reopen-month', {
      headers: admin.headers, data: { month, userId: lisa.id },
    });

    const manual = (day, time, type) => request.post('/api/time/manual', {
      headers: admin.headers,
      data: {
        userId: lisa.id,
        type,
        timestamp: new Date(`${month}-${day}T${time}:00`).toISOString(),
        note: 'e2e Sammel-Abschluss',
      },
    });

    // Sauberer Tag + ein OFFENER Stempel (nur Kommen) an einem anderen Tag.
    expect((await manual('10', '09:00', 'in')).status()).toBe(201);
    expect((await manual('10', '17:00', 'out')).status()).toBe(201);
    expect((await manual('12', '09:00', 'in')).status()).toBe(201);

    // --- Buchhaltung: Sammel-Abschluss scheitert am unvollständigen Tag ---
    await uiLogin(page, 'buchhaltung');
    await page.goto('/manage-times');
    await page.locator('#manage-month-picker').fill(month);
    await expect(page.getByRole('row', { name: new RegExp(USERS.mitarbeiter.name) })).toBeVisible();

    await page.getByRole('button', { name: 'Monat für alle abschließen' }).click();
    await page.getByRole('button', { name: 'Bestätigen', exact: true }).click();

    // INCOMPLETE_DAYS → Hinweisbox mit Mitarbeiter und Datum (dd.MM.)
    await expect(page.getByText('Abschluss blockiert — unvollständige Tage')).toBeVisible();
    const [, mm] = month.split('-');
    await expect(
      page.getByText(new RegExp(`${USERS.mitarbeiter.name}.*12\\.${mm}\\.`))
    ).toBeVisible();

    // Offenen Tag per API vervollständigen → Sammel-Abschluss klappt.
    expect((await manual('12', '10:00', 'out')).status()).toBe(201);

    await page.getByRole('button', { name: 'Monat für alle abschließen' }).click();
    await page.getByRole('button', { name: 'Bestätigen', exact: true }).click();
    await expectToast(page, 'Monat für alle Mitarbeiter abgeschlossen.');

    // Abschluss-Badges in der Übersicht (alle Zeilen, mind. Lisas).
    await expect(
      page.getByRole('row', { name: new RegExp(USERS.mitarbeiter.name) }).getByText('Abgeschlossen')
    ).toBeVisible();

    // Nachbuchen im gesperrten Monat → 423 MONTH_LOCKED.
    const blocked = await manual('11', '09:00', 'in');
    expect(blocked.status()).toBe(423);

    // Buchhaltung sieht KEINEN „Für alle wieder öffnen"-Button (nur Admin).
    await expect(page.getByRole('button', { name: 'Für alle wieder öffnen' })).toHaveCount(0);

    // --- Admin öffnet für alle wieder ---
    const a = await newRolePage(browser, 'admin');
    await a.page.goto('/manage-times');
    await a.page.locator('#manage-month-picker').fill(month);
    await expect(
      a.page.getByRole('row', { name: new RegExp(USERS.mitarbeiter.name) }).getByText('Abgeschlossen')
    ).toBeVisible();

    await a.page.getByRole('button', { name: 'Für alle wieder öffnen' }).click();
    await a.page.getByRole('button', { name: 'Bestätigen', exact: true }).click();
    await expectToast(a.page, 'Monat für alle wieder geöffnet.');
    await expect(
      a.page.getByRole('row', { name: new RegExp(USERS.mitarbeiter.name) }).getByText('Abgeschlossen')
    ).toHaveCount(0);
    await a.context.close();

    // Monat ist wieder offen: Nachbuchen funktioniert (Paar → Monat bleibt sauber).
    expect((await manual('11', '09:00', 'in')).status()).toBe(201);
    expect((await manual('11', '10:00', 'out')).status()).toBe(201);
  });
});
