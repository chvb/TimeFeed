// @ts-check
// Playwright globalTeardown: entfernt RESTLOS alle e2e-Daten nach der Suite —
// unabhängig davon, ob Tests fehlgeschlagen sind.
const { cleanupTestData, restoreEmails, closeDb } = require('./lib/test-data');

module.exports = async () => {
  await restoreEmails(); // ursprünglichen E-Mail-Zustand wiederherstellen
  await cleanupTestData();
  await closeDb();
  console.log('[e2e] E-Mail-Zustand wiederhergestellt, Testdaten restlos bereinigt');
};
