// @ts-check
const fs = require('fs');
const path = require('path');

// .env.test laden (liegt im e2e-Root, eine Ebene über tests/). Gitignored.
// Einfacher KEY=VALUE-Parser, damit e2e keine eigene dotenv-Dependency braucht.
(function loadEnvTest() {
  try {
    const envPath = path.join(__dirname, '..', '.env.test');
    if (fs.existsSync(envPath)) {
      fs.readFileSync(envPath, 'utf-8')
        .split('\n')
        .forEach((line) => {
          const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
          if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
        });
    }
  } catch (_) {
    /* Fallback: Default-Passwort unten */
  }
})();

// Gemeinsames Test-Passwort für alle e2e-User. Wird von setup-test-users.js
// gesetzt. Override via E2E_PASSWORD oder .env.test.
const PASSWORD = process.env.E2E_PASSWORD || 'E2ETestPassword123!';

// Dedizierte @test.local-Adressen — keine Kollision mit echten Accounts.
const TEST_USERS = {
  admin: { email: 'e2e-admin@test.local', role: 'admin', password: PASSWORD },
  hr: { email: 'e2e-hr@test.local', role: 'hr', password: PASSWORD },
  manager: { email: 'e2e-manager@test.local', role: 'manager', password: PASSWORD },
  employee: { email: 'e2e-employee@test.local', role: 'employee', password: PASSWORD },
};

/**
 * Login → liefert { token, user, headers }
 */
async function login(request, role = 'admin') {
  const creds = TEST_USERS[role];
  if (!creds) throw new Error(`Unbekannte Test-Rolle: ${role}`);
  const res = await request.post('/api/auth/login', {
    data: { email: creds.email, password: creds.password },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Login fehlgeschlagen für ${role}: ${res.status()} ${body}`);
  }
  const data = await res.json();
  return {
    token: data.token,
    user: data.user,
    headers: { Authorization: `Bearer ${data.token}` },
  };
}

/** Eindeutiger Suffix für kollisionsfreie Testdaten */
function uniq() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Liefert ein zukünftiges ISO-Datumsfenster (YYYY-MM-DD), um Überlappungen
 * mit bestehenden Urlaubsanträgen zu vermeiden.
 * @param {number} startOffsetDays Tage ab heute
 * @param {number} lengthDays Länge in Tagen
 */
function futureRange(startOffsetDays, lengthDays) {
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + startOffsetDays);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + Math.max(0, lengthDays - 1));
  const fmt = (d) => d.toISOString().slice(0, 10);
  return { startDate: fmt(start), endDate: fmt(end) };
}

module.exports = { TEST_USERS, PASSWORD, login, uniq, futureRange };
