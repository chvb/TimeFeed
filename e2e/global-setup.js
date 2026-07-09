// @ts-check
/**
 * Playwright globalSetup: startet einen EIGENEN TimeFeed-Server (dist-Build)
 * auf Port 3040 mit frischer Wegwerf-SQLite-DB im Scratch-Verzeichnis.
 * Der Server seeded beim ersten Start die Demo-User (admin/buchhaltung/
 * verwaltung/mitarbeiter @timefeed.de) mit den festen SEED_*-Passwörtern.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  PORT, BASE_URL, SERVER_DIR, DB_FILE, PID_FILE, LOG_FILE, JWT_SECRET, HANDOFF_SECRET,
  SEED_PASSWORDS, ensureTmpDir,
} = require('./lib/env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killStaleServer() {
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf-8').trim());
    if (pid > 0) process.kill(pid, 'SIGKILL');
  } catch (_) { /* kein alter Prozess */ }
  try { fs.unlinkSync(PID_FILE); } catch (_) { /* ignore */ }
}

function removeDb() {
  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_FILE + suffix); } catch (_) { /* ignore */ }
  }
}

module.exports = async () => {
  ensureTmpDir();
  killStaleServer();
  removeDb();

  const entry = path.join(SERVER_DIR, 'dist', 'index.js');
  if (!fs.existsSync(entry)) {
    throw new Error(`Server-Build fehlt: ${entry} — bitte zuerst server bauen.`);
  }

  const env = {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    JWT_SECRET,
    TIMEFEED_HANDOFF_SECRET: HANDOFF_SECRET,
    DATABASE_URL: `sqlite:${DB_FILE}`,
    SEED_ADMIN_PASSWORD: SEED_PASSWORDS.admin,
    SEED_BUCHHALTUNG_PASSWORD: SEED_PASSWORDS.buchhaltung,
    SEED_VERWALTUNG_PASSWORD: SEED_PASSWORDS.verwaltung,
    SEED_MITARBEITER_PASSWORD: SEED_PASSWORDS.mitarbeiter,
    // e2e läuft über Loopback ohne Proxy/TLS.
    TRUST_PROXY: 'loopback',
    FORCE_HTTPS: 'false',
    CORS_ORIGIN: BASE_URL,
    PUBLIC_URL: BASE_URL,
  };

  const out = fs.openSync(LOG_FILE, 'w');
  const child = spawn(process.execPath, [entry], {
    cwd: SERVER_DIR,
    env,
    detached: true,
    stdio: ['ignore', out, out],
  });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));

  // Warten, bis der Server antwortet (Seeding läuft VOR listen()).
  let healthy = false;
  for (let i = 0; i < 120; i++) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) { healthy = true; break; }
    } catch (_) { /* Server startet noch */ }
    await sleep(500);
  }
  if (!healthy) {
    const log = fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf-8').slice(-4000) : '';
    throw new Error(`e2e-Server wurde nicht gesund (Port ${PORT}).\n--- Server-Log ---\n${log}`);
  }

  // Sanity: Seed-Login des Admins muss funktionieren.
  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@timefeed.de', password: SEED_PASSWORDS.admin }),
  });
  if (!login.ok) {
    const body = await login.text();
    throw new Error(`Seed-Admin-Login fehlgeschlagen (${login.status}): ${body}`);
  }

  console.log(`[e2e] TimeFeed-Server läuft auf ${BASE_URL} (PID ${child.pid}, DB ${DB_FILE})`);
};
