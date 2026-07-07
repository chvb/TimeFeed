// @ts-check
// Periodische Berichts-Mails (Settings → Benachrichtigungen → „Berichte per
// E-Mail"): Settings-Roundtrip über die UI (4 Perioden-Toggles + Empfänger-
// Liste) und „Jetzt senden"-Testversand — ohne SMTP im e2e zeigt die UI den
// SMTP-inaktiv-Fall sauber als Toast ({sent:false, reason:'SMTP_INACTIVE'}).
const { test, expect } = require('@playwright/test');
const { login, uiLogin, expectToast } = require('./helpers');

// Eigener FIRMEN-Admin (kein Super-Admin): der Seed-Admin würde die GLOBALE
// Vorlage bearbeiten — die Berichts-Einstellungen sind aber firmen-scoped
// (Muster wie 15-timesheet-mail.spec.js).
const RP_ADMIN = { email: 'e2e-report-admin@timefeed.de', password: 'E2eReportAdmin_123!' };

async function ensureReportAdmin(request) {
  const admin = await login(request, 'admin');
  const res = await request.post('/api/users', {
    headers: admin.headers,
    data: {
      email: RP_ADMIN.email, password: RP_ADMIN.password,
      firstName: 'Rita', lastName: 'Report', role: 'admin',
      companyId: admin.user.companyId,
    },
  });
  expect([201, 400]).toContain(res.status()); // 400 = existiert bereits
  return admin;
}

async function readCompanySettings(request) {
  const auth = await login(request, RP_ADMIN);
  const body = await (await request.get('/api/settings', { headers: auth.headers })).json();
  return body.settings || body;
}

test.describe('Berichts-Mails', () => {
  test.afterAll(async ({ request }) => {
    // Einstellungen der Firma zurücksetzen (Wegwerf-Prinzip).
    try {
      const auth = await login(request, RP_ADMIN);
      await request.put('/api/settings', {
        headers: auth.headers,
        data: {
          reportDailyEnabled: false, reportMonthlyEnabled: false,
          reportQuarterlyEnabled: false, reportYearlyEnabled: false,
          reportRecipients: null,
        },
      });
    } catch (_) { /* best-effort */ }
  });

  test('Settings-Roundtrip: Toggles + Empfänger speichern/laden', async ({ page, request }) => {
    await ensureReportAdmin(request);

    await uiLogin(page, RP_ADMIN);
    await page.goto('/settings?tab=notifications');
    await expect(page.getByRole('heading', { name: 'Berichte per E-Mail' })).toBeVisible();

    // Alle vier Perioden-Zeilen sichtbar (aria-Label = Perioden-Titel).
    for (const label of ['Tagesbericht', 'Monatsbericht', 'Quartalsbericht', 'Jahresbericht']) {
      await expect(page.getByLabel(label, { exact: true })).toBeVisible();
    }

    // Tag + Quartal aktivieren, Empfänger-Liste setzen, speichern.
    await page.getByLabel('Tagesbericht', { exact: true }).check();
    await page.getByLabel('Quartalsbericht', { exact: true }).check();
    const recipients = page.getByPlaceholder('leer = alle Admins der Firma');
    await recipients.fill('chef@example.com, lohn@example.com');
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expectToast(page, 'Einstellungen gespeichert');

    // API: firmenspezifische Zeile trägt die Werte (normalisierte Komma-Liste).
    const s1 = await readCompanySettings(request);
    expect(s1.reportDailyEnabled).toBe(true);
    expect(s1.reportMonthlyEnabled).toBe(false);
    expect(s1.reportQuarterlyEnabled).toBe(true);
    expect(s1.reportYearlyEnabled).toBe(false);
    expect(s1.reportRecipients).toBe('chef@example.com, lohn@example.com');

    // Reload: Formular zeigt die gespeicherten Werte wieder an.
    await page.reload();
    await expect(page.getByLabel('Tagesbericht', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Monatsbericht', { exact: true })).not.toBeChecked();
    await expect(page.getByLabel('Quartalsbericht', { exact: true })).toBeChecked();
    await expect(recipients).toHaveValue('chef@example.com, lohn@example.com');

    // Validierung: ungültige Empfänger-Liste wird serverseitig abgelehnt (400).
    const auth = await login(request, RP_ADMIN);
    const bad = await request.put('/api/settings', {
      headers: auth.headers,
      data: { reportRecipients: 'keine-mail' },
    });
    expect(bad.status()).toBe(400);
  });

  test('„Jetzt senden": SMTP-inaktiv-Fall sauber als Toast', async ({ page, request }) => {
    await ensureReportAdmin(request);

    await uiLogin(page, RP_ADMIN);
    await page.goto('/settings?tab=notifications');
    await expect(page.getByRole('heading', { name: 'Berichte per E-Mail' })).toBeVisible();

    // Vier „Jetzt senden"-Buttons (je Periode); Testversand ist auch bei
    // deaktivierter Periode möglich.
    const sendButtons = page.getByRole('button', { name: 'Jetzt senden', exact: true });
    await expect(sendButtons).toHaveCount(4);

    // Ohne SMTP-Konfiguration: {sent:false, reason:'SMTP_INACTIVE'} → Fehler-Toast.
    await sendButtons.first().click();
    await expectToast(page, 'E-Mail-Versand ist nicht konfiguriert (SMTP inaktiv)');

    // API-Shape direkt gegenprüfen (kein 500, definierter reason).
    const auth = await login(request, RP_ADMIN);
    const res = await request.post('/api/reports/send-test', {
      headers: auth.headers,
      data: { period: 'quarter' },
    });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.sent).toBe(false);
    expect(body.reason).toBe('SMTP_INACTIVE');
    expect(body.title).toMatch(/^Quartalsbericht Q[1-4] \d{4}$/);

    // Ungültige Periode → 400.
    const bad = await request.post('/api/reports/send-test', {
      headers: auth.headers,
      data: { period: 'week' },
    });
    expect(bad.status()).toBe(400);
  });
});
