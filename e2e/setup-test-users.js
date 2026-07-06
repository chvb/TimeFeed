#!/usr/bin/env node
/**
 * Manuelles Anlegen der e2e-Test-User (optional — die Suite macht das via
 * globalSetup automatisch). Nur auf Dev-Server ausführen.
 *   node e2e/setup-test-users.js
 */
const { createTestUsers, closeDb, testPassword } = require('./lib/test-data');

(async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('FEHLER: Niemals auf Produktion ausführen!');
    process.exit(1);
  }
  await createTestUsers();
  await closeDb();
  console.log(`Test-User angelegt. Passwort: ${testPassword()}`);
})().catch((err) => {
  console.error('Fehler:', err.message);
  process.exit(1);
});
