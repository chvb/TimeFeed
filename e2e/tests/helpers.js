// @ts-check
/**
 * Gemeinsame Helfer für die TimeFeed-e2e-Suite.
 *
 * Rollen/Demo-Seeds (@timefeed.de) werden vom Server beim ersten Start mit
 * den festen SEED_*-Passwörtern aus lib/env.js angelegt:
 *   admin        → Max Mustermann   (Super-Admin)
 *   buchhaltung  → Anna Schmidt
 *   verwaltung   → Thomas Müller    (Manager der Gruppe „Entwicklung")
 *   mitarbeiter  → Lisa Weber       (Mitglied „Entwicklung")
 */
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');
const { SEED_PASSWORDS, SERVER_DIR, CLIENT_DIR } = require('../lib/env');

const USERS = {
  admin: { email: 'admin@timefeed.de', password: SEED_PASSWORDS.admin, name: 'Max Mustermann' },
  buchhaltung: { email: 'buchhaltung@timefeed.de', password: SEED_PASSWORDS.buchhaltung, name: 'Anna Schmidt' },
  verwaltung: { email: 'verwaltung@timefeed.de', password: SEED_PASSWORDS.verwaltung, name: 'Thomas Müller' },
  mitarbeiter: { email: 'mitarbeiter@timefeed.de', password: SEED_PASSWORDS.mitarbeiter, name: 'Lisa Weber' },
};

/** API-Login → { token, user, headers }. role = Seed-Rolle ODER { email, password }. */
async function login(request, role) {
  const creds = typeof role === 'object' ? role : USERS[role];
  if (!creds) throw new Error(`Unbekannte Rolle: ${role}`);
  const res = await request.post('/api/auth/login', {
    data: { email: creds.email, password: creds.password },
  });
  if (!res.ok()) {
    throw new Error(`Login fehlgeschlagen für ${role}: ${res.status()} ${await res.text()}`);
  }
  const data = await res.json();
  return { token: data.token, user: data.user, headers: { Authorization: `Bearer ${data.token}` } };
}

/**
 * Client-Build-Version (APP_VERSION) aus dem ausgelieferten Bundle ermitteln —
 * nötig, um Changelog-Modal („Was ist neu") und Update-Banner/Auto-Reload in
 * den UI-Tests zu neutralisieren (Server- und Client-Version können abweichen).
 */
let cachedAppVersion = null;
function clientAppVersion() {
  if (cachedAppVersion) return cachedAppVersion;
  let fallback = '0.0.0';
  try {
    fallback = JSON.parse(fs.readFileSync(path.join(CLIENT_DIR, 'package.json'), 'utf-8')).version || fallback;
  } catch (_) { /* ignore */ }
  try {
    const assetsDir = path.join(SERVER_DIR, 'public', 'assets');
    const indexJs = fs.readdirSync(assetsDir).find((f) => /^index-.*\.js$/.test(f));
    if (indexJs) {
      const src = fs.readFileSync(path.join(assetsDir, indexJs), 'utf-8');
      const versions = [...src.matchAll(/="(\d+\.\d+\.\d+)"/g)].map((m) => m[1]);
      // Bevorzugt die Version, die zur client/package.json passt; sonst die erste.
      cachedAppVersion = versions.find((v) => v === fallback) || versions[0] || fallback;
      return cachedAppVersion;
    }
  } catch (_) { /* ignore */ }
  cachedAppVersion = fallback;
  return cachedAppVersion;
}

/**
 * Seite für UI-Tests vorbereiten (VOR page.goto aufrufen):
 *  - „Was ist neu"-Modal unterdrücken (tf-changelog-seen = Client-Version)
 *  - /health-Version auf die Client-Version normieren → kein Update-Banner
 *    und kein window.location.reload() bei Seitenwechseln.
 */
async function prepPage(page) {
  const version = clientAppVersion();
  await page.addInitScript((v) => {
    try {
      localStorage.setItem('tf-changelog-seen', v);
      localStorage.setItem('tf-lang', 'de');
    } catch (_) { /* ignore */ }
  }, version);
  await page.route('**/health', async (route) => {
    try {
      const response = await route.fetch();
      const json = await response.json();
      json.version = version;
      await route.fulfill({ response, json });
    } catch (_) {
      await route.continue();
    }
  });
}

/**
 * UI-Login ohne Formular: API-Login + Auth-State (zustand-persist) in
 * localStorage injizieren. Danach einfach page.goto('/…').
 */
async function uiLogin(page, role) {
  const auth = await login(page.request, role);
  await prepPage(page);
  await page.addInitScript(({ key, value }) => {
    try { localStorage.setItem(key, value); } catch (_) { /* ignore */ }
  }, {
    key: 'auth-storage',
    value: JSON.stringify({
      state: { token: auth.token, user: auth.user, isAuthenticated: true },
      version: 0,
    }),
  });
  return auth;
}

/**
 * Eigenen Browser-Kontext + Seite für eine weitere Rolle öffnen (z. B. Verwalter
 * parallel zum Mitarbeiter). Aufrufer schließt mit `ctx.context.close()`.
 */
async function newRolePage(browser, role) {
  const { BASE_URL } = require('../lib/env');
  const context = await browser.newContext({ baseURL: BASE_URL, locale: 'de-DE' });
  const page = await context.newPage();
  const auth = await uiLogin(page, role);
  return { context, page, auth };
}

/** Toast-Text (react-hot-toast) sichtbar. */
async function expectToast(page, text) {
  await expect(page.getByText(text).first()).toBeVisible();
}

// ---------------------------------------------------------------------------
// Datums-Helfer
// ---------------------------------------------------------------------------

const pad2 = (n) => String(n).padStart(2, '0');

/** Lokales Datum als YYYY-MM-DD. */
function ymd(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Aktueller Monat als YYYY-MM. */
function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** Vormonat als YYYY-MM. */
function prevMonth() {
  const d = new Date();
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  return `${p.getFullYear()}-${pad2(p.getMonth() + 1)}`;
}

/** HH:MM eines Date. */
function hhmm(d) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Datumszelle wie in den Zeit-Tabellen (de-DE, z. B. „Mo., 06.07."). */
function fmtDayCell(dateStr) {
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString('de-DE', {
    weekday: 'short', day: '2-digit', month: '2-digit',
  });
}

/**
 * Sicherer Slot für Nachbuchungen/Korrekturen im AKTUELLEN Monat, garantiert
 * in der Vergangenheit: normalerweise heute (bzw. gestern kurz nach
 * Mitternacht) mit festen Nacht-Zeiten; Fallback dicht an „jetzt".
 */
function pastSlotInCurrentMonth() {
  const now = new Date();
  let day = new Date(now);
  if (now.getHours() < 3) day.setDate(day.getDate() - 1);
  if (ymd(day).slice(0, 7) !== currentMonth()) {
    // Monatsanfang kurz nach Mitternacht → Zeiten kurz vor „jetzt" am heutigen Tag.
    const t2 = new Date(now.getTime() - 5 * 60000);
    const t1 = new Date(now.getTime() - 15 * 60000);
    if (ymd(t1) !== ymd(now)) return { date: ymd(now), t1: '00:01', t2: '00:03' };
    return { date: ymd(now), t1: hhmm(t1), t2: hhmm(t2) };
  }
  return { date: ymd(day), t1: '01:00', t2: '02:00' };
}

module.exports = {
  USERS,
  login,
  uiLogin,
  newRolePage,
  prepPage,
  expectToast,
  clientAppVersion,
  ymd,
  hhmm,
  currentMonth,
  prevMonth,
  fmtDayCell,
  pastSlotInCurrentMonth,
};
