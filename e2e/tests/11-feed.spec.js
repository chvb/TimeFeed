// @ts-check
// Feed-Seite (v1.1.0): persönliche Karten für Mitarbeiter, Unternehmens-Digest
// für Buchhaltung, Filter-Chips. Chips tragen den Zähler im Namen ("Alles 12")
// → Matching per /^Label/-Regex.
const { test, expect } = require('@playwright/test');
const { login, uiLogin, ymd } = require('./helpers');

const chip = (page, label) => page.getByRole('button', { name: new RegExp(`^${label}`) });

test.describe('Feed', () => {
  test('Mitarbeiter: persönliche Karten, kein „Unternehmen"-Chip', async ({ page }) => {
    await uiLogin(page, 'mitarbeiter');
    await page.goto('/feed');

    await expect(page.getByRole('heading', { name: 'Feed' })).toBeVisible();
    await expect(page.getByText('Alles auf einen Blick — Ihr Aktivitäts-Stream.')).toBeVisible();

    // Persönliche Karten sind immer vorhanden: Stempel-Status + Wochen-Zusammenfassung.
    await expect(
      page.getByText(/Sie sind (ausgestempelt|eingestempelt|in der Pause)/).first()
    ).toBeVisible();
    await expect(page.getByText(/Ihre Arbeitswoche:/).first()).toBeVisible();
    await expect(page.getByText('Wochensaldo').first()).toBeVisible();
    await expect(page.getByText(/Ihr Zeitkonto:/).first()).toBeVisible();

    // KPI-Kacheln des Mitarbeiters (ohne Manager-Kachel „Anwesend jetzt").
    await expect(page.getByText('Mein Saldo')).toBeVisible();
    await expect(page.getByText('Anwesend jetzt')).toHaveCount(0);

    // Chips: Alles/Persönlich ja — „Unternehmen" NICHT für Mitarbeiter.
    await expect(chip(page, 'Alles')).toBeVisible();
    await expect(chip(page, 'Persönlich')).toBeVisible();
    await expect(chip(page, 'Unternehmen')).toHaveCount(0);
  });

  test('Buchhaltung: „Unternehmen"-Chip mit Digest-Karten, Filter wechseln', async ({ page, request }) => {
    // Testdaten: gestempelte Zeit in der aktuellen Woche (heute), damit der
    // Wochen-Digest echte Werte hat.
    const admin = await login(request, 'admin');
    const users = (await (await request.get('/api/users', { headers: admin.headers })).json()).users;
    const lisa = users.find((u) => u.email === 'mitarbeiter@timefeed.de');
    for (const [time, type] of [['03:00', 'in'], ['04:00', 'out']]) {
      const res = await request.post('/api/time/manual', {
        headers: admin.headers,
        data: {
          userId: lisa.id,
          type,
          timestamp: new Date(`${ymd()}T${time}:00`).toISOString(),
          note: 'e2e Feed-Digest',
        },
      });
      expect([201, 409]).toContain(res.status()); // 409 falls Sequenz durch andere Specs belegt
    }

    await uiLogin(page, 'buchhaltung');
    await page.goto('/feed');
    await expect(page.getByRole('heading', { name: 'Feed' })).toBeVisible();

    // Manager-KPI + „Unternehmen"-Chip sind da.
    await expect(page.getByText('Anwesend jetzt')).toBeVisible();
    await expect(chip(page, 'Unternehmen')).toBeVisible();

    // Filter „Unternehmen" → mindestens eine Digest-Karte sichtbar.
    await chip(page, 'Unternehmen').click();
    await expect(page.getByText('Wochenüberblick des Unternehmens')).toBeVisible();
    await expect(page.getByText(/Monatsabschluss /).first()).toBeVisible();
    // Persönliche Karte ist unter diesem Filter ausgeblendet.
    await expect(page.getByText(/Sie sind (ausgestempelt|eingestempelt|in der Pause)/)).toHaveCount(0);

    // Filter „Persönlich" → Digest weg, persönliche Karten wieder da.
    await chip(page, 'Persönlich').click();
    await expect(page.getByText('Wochenüberblick des Unternehmens')).toHaveCount(0);
    await expect(
      page.getByText(/Sie sind (ausgestempelt|eingestempelt|in der Pause)/).first()
    ).toBeVisible();

    // Zurück auf „Alles" → beides sichtbar.
    await chip(page, 'Alles').click();
    await expect(page.getByText('Wochenüberblick des Unternehmens')).toBeVisible();
    await expect(page.getByText(/Ihre Arbeitswoche:/).first()).toBeVisible();
  });
});
