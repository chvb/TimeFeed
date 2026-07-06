#!/usr/bin/env node
/**
 * Manuelles, restloses Entfernen aller e2e-Testdaten (Urlaube, Krankmeldungen,
 * Audit-Logs der Test-User, e2e-Gruppen/-Feiertage/-Abteilungen und alle
 * @test.local-User). Wird normalerweise automatisch via globalTeardown
 * ausgeführt — dieses Skript ist für manuelles Aufräumen.
 *   node e2e/cleanup-test-data.js
 */
const { cleanupTestData, closeDb } = require('./lib/test-data');

(async () => {
  await cleanupTestData();
  await closeDb();
  console.log('Alle e2e-Testdaten restlos entfernt.');
})().catch((err) => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
