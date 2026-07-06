// @ts-check
/**
 * Playwright globalTeardown: e2e-Server beenden und Wegwerf-DB löschen —
 * unabhängig vom Test-Ergebnis.
 */
const fs = require('fs');
const { DB_FILE, PID_FILE } = require('./lib/env');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isAlive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (_) { return false; }
};

module.exports = async () => {
  let pid = 0;
  try { pid = Number(fs.readFileSync(PID_FILE, 'utf-8').trim()); } catch (_) { /* ignore */ }

  if (pid > 0 && isAlive(pid)) {
    try { process.kill(pid, 'SIGTERM'); } catch (_) { /* ignore */ }
    for (let i = 0; i < 20 && isAlive(pid); i++) await sleep(250);
    if (isAlive(pid)) {
      try { process.kill(pid, 'SIGKILL'); } catch (_) { /* ignore */ }
    }
  }
  try { fs.unlinkSync(PID_FILE); } catch (_) { /* ignore */ }

  for (const suffix of ['', '-wal', '-shm']) {
    try { fs.unlinkSync(DB_FILE + suffix); } catch (_) { /* ignore */ }
  }

  console.log('[e2e] Server beendet, Wegwerf-DB gelöscht');
};
