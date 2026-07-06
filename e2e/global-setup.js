// @ts-check
// Playwright globalSetup: E-Mail-Versand abschalten + e2e-Test-User anlegen.
const { createTestUsers, cleanupTestData, disableEmails } = require('./lib/test-data');

module.exports = async () => {
  // Reste vorheriger (ggf. abgebrochener) Läufe vorab entfernen, dann frische
  // Test-User anlegen — so startet jede Suite auf sauberem Stand.
  // Bewusst KEIN closeDb(): globalSetup und globalTeardown teilen sich im
  // selben Runner-Prozess dieselbe Sequelize-Instanz; geschlossen wird erst
  // im Teardown.
  await cleanupTestData();
  await disableEmails(); // keine Mails (Urlaubsanträge etc.) während der Tests
  await createTestUsers();
  console.log('[e2e] E-Mail-Versand deaktiviert, Test-User angelegt');
};
