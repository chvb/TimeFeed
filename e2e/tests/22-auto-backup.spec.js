// @ts-check
// Automatisches Backup-System (Settings → Backup → „Automatische Backups"):
// Settings-Roundtrip über das bestehende PUT /api/settings (globale Vorlage),
// Sofort-Backup über den „Jetzt sichern"-Button (POST /api/storage/auto-backup-run)
// und Status-Card (GET /api/storage/auto-backup-status). Erzeugte Backup-Dateien
// unter server/backups/ werden hinterher wieder aufgeräumt.
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { login, uiLogin, expectToast } = require('./helpers');
const { SERVER_DIR } = require('../lib/env');

const BACKUP_DIR = path.join(SERVER_DIR, 'backups');

/** Aktuelle Auto-Backup-Dateien in server/backups/ (nie last-status.json). */
function listBackupFiles() {
  try {
    return fs.readdirSync(BACKUP_DIR).filter((f) => /^timefeed-backup-.*\.json$/.test(f));
  } catch (_) {
    return [];
  }
}

test.describe('Automatische Backups', () => {
  /** @type {string[]} Bestand vor dem Test — nur im Test entstandene Dateien löschen. */
  let filesBefore = [];

  test.beforeAll(() => {
    filesBefore = listBackupFiles();
  });

  test.afterAll(async ({ request }) => {
    // Im Test entstandene Backup-Dateien entfernen (Wegwerf-Prinzip).
    for (const f of listBackupFiles()) {
      if (!filesBefore.includes(f)) {
        try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (_) { /* ignore */ }
      }
    }
    // Einstellungen auf die Defaults zurücksetzen (globale Vorlage).
    try {
      const admin = await login(request, 'admin');
      await request.put('/api/settings', {
        headers: admin.headers,
        data: {
          autoBackupEnabled: true,
          autoBackupTime: '02:30',
          backupRetentionDays: 30,
          backupNotifyOnFailure: true,
        },
      });
    } catch (_) { /* best-effort */ }
  });

  test('Settings-Roundtrip, „Jetzt sichern"-Button und Status-Card', async ({ page, request }) => {
    await uiLogin(page, 'admin'); // Seed-Admin ist Super-Admin
    await page.goto('/settings?tab=backup');
    await expect(page.getByRole('heading', { name: 'Backup-System' })).toBeVisible();

    // Abschnitt „Automatische Backups" mit Einstellungs- und Status-Card.
    await expect(page.getByRole('heading', { name: 'Automatische Backups', exact: true })).toBeVisible();
    const settingsCard = page.locator('.card').filter({
      has: page.getByLabel('Automatische Backups aktivieren'),
    });
    const statusCard = page.locator('.card').filter({
      has: page.getByRole('button', { name: 'Jetzt sichern', exact: true }),
    });
    await expect(settingsCard).toBeVisible();
    await expect(statusCard).toBeVisible();

    // --- 1) Settings-Roundtrip (Toggle, Uhrzeit, Aufbewahrung, Fehler-Mail) --
    await settingsCard.getByLabel('Automatische Backups aktivieren').check();
    await settingsCard.locator('input[type="time"]').fill('04:45');
    await settingsCard.locator('input[type="number"]').fill('14');
    await settingsCard.getByLabel('E-Mail an Admins bei fehlgeschlagenem Backup').uncheck();
    await settingsCard.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expectToast(page, 'Einstellungen gespeichert');

    // API: globale Vorlage trägt die Werte, nächster Lauf liegt in der Zukunft.
    const admin = await login(request, 'admin');
    const status1 = await (
      await request.get('/api/storage/auto-backup-status', { headers: admin.headers })
    ).json();
    expect(status1.settings.autoBackupEnabled).toBe(true);
    expect(status1.settings.autoBackupTime).toBe('04:45');
    expect(status1.settings.backupRetentionDays).toBe(14);
    expect(status1.settings.backupNotifyOnFailure).toBe(false);
    expect(status1.nextRunAt).toBeTruthy();
    expect(new Date(status1.nextRunAt).getTime()).toBeGreaterThan(Date.now());

    // Reload: Formular zeigt die gespeicherten (globalen) Werte wieder an.
    await page.reload();
    await expect(settingsCard.locator('input[type="time"]')).toHaveValue('04:45');
    await expect(settingsCard.locator('input[type="number"]')).toHaveValue('14');
    await expect(
      settingsCard.getByLabel('E-Mail an Admins bei fehlgeschlagenem Backup')
    ).not.toBeChecked();

    // Validierung: Aufbewahrung unter 7 Tagen wird serverseitig abgelehnt.
    const bad = await request.put('/api/settings', {
      headers: admin.headers,
      data: { backupRetentionDays: 3 },
    });
    expect(bad.status()).toBe(400);

    // --- 2) „Jetzt sichern" → Ergebnis-Toast + lokale Datei ------------------
    await statusCard.getByRole('button', { name: 'Jetzt sichern', exact: true }).click();
    await expectToast(page, /Backup erstellt/);

    const created = listBackupFiles().filter((f) => !filesBefore.includes(f));
    expect(created.length).toBeGreaterThan(0);

    // --- 3) Status-Card zeigt den Lauf (Zeitpunkt, OK-Badge, Ziel, nächster Lauf)
    await expect(statusCard.getByText('Letzter Lauf')).toBeVisible();
    await expect(statusCard.getByText('OK', { exact: true })).toBeVisible();
    await expect(statusCard.getByText('Ziel')).toBeVisible();
    await expect(statusCard.getByText('Nächster Lauf')).toBeVisible();

    // API-Status spiegelt den Lauf: ok, Größe > 0, Ziel lokal (oder S3+lokal).
    const status2 = await (
      await request.get('/api/storage/auto-backup-status', { headers: admin.headers })
    ).json();
    expect(status2.lastStatus).toBeTruthy();
    expect(status2.lastStatus.ok).toBe(true);
    expect(status2.lastStatus.sizeBytes).toBeGreaterThan(0);
    expect(['local', 's3+local']).toContain(status2.lastStatus.target);
    expect(typeof status2.lastStatus.durationMs).toBe('number');

    // Nicht-Super-Admin-Schutz: Status-Endpoint ist Super-Admin-only.
    const buchhaltung = await login(request, 'buchhaltung');
    const forbidden = await request.get('/api/storage/auto-backup-status', {
      headers: buchhaltung.headers,
    });
    expect(forbidden.status()).toBe(403);
  });
});
