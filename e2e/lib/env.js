// @ts-check
/**
 * Zentrale Konfiguration der e2e-Suite: eigener TimeFeed-Server auf Port 3040
 * mit Wegwerf-SQLite-DB und festen Seed-Passwörtern (Demo-User @timefeed.de).
 * Der Produktivserver (3030) wird NICHT angefasst.
 */
const path = require('path');
const fs = require('fs');

// Wegwerf-Verzeichnis für DB/Logs. Per E2E_TMP_DIR übersteuerbar.
const TMP_DIR =
  process.env.E2E_TMP_DIR ||
  '/tmp/claude-1000/-opt-TimeFeed/39f7b721-b9f8-4c1f-ba73-9c456d44ac1d/scratchpad';

const PORT = Number(process.env.E2E_PORT || 3040);

// Feste Seed-Passwörter: der Server seeded die Demo-User beim ersten Start
// (leere DB) mit genau diesen Werten (SEED_*-Env-Variablen).
const SEED_PASSWORDS = {
  admin: 'E2eAdmin_Pass123!',
  buchhaltung: 'E2eBuchhaltung_Pass123!',
  verwaltung: 'E2eVerwaltung_Pass123!',
  mitarbeiter: 'E2eMitarbeiter_Pass123!',
};

function ensureTmpDir() {
  fs.mkdirSync(TMP_DIR, { recursive: true });
  return TMP_DIR;
}

module.exports = {
  PORT,
  BASE_URL: `http://127.0.0.1:${PORT}`,
  SERVER_DIR: path.resolve(__dirname, '..', '..', 'server'),
  CLIENT_DIR: path.resolve(__dirname, '..', '..', 'client'),
  TMP_DIR,
  DB_FILE: path.join(TMP_DIR, 'e2e.sqlite'),
  PID_FILE: path.join(TMP_DIR, 'e2e-server.pid'),
  LOG_FILE: path.join(TMP_DIR, 'e2e-server.log'),
  JWT_SECRET: 'e2e-test-secret',
  SEED_PASSWORDS,
  ensureTmpDir,
};
