// @ts-check
// Security-Härtung: Konto-Sperre nach Fehlversuchen, Token-Widerruf („auf allen
// Geräten abmelden") und konfigurierbare Session-Dauer (JWT-Ablauf).
// Nutzt eigens angelegte Wegwerf-User, um die 4 Seed-User (und deren Sessions)
// nicht zu beeinträchtigen.
const { test, expect } = require('@playwright/test');
const { login, USERS } = require('./helpers');

/** JWT-Payload ohne Signaturprüfung dekodieren (nur exp/iat lesen). */
function decodeJwt(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
}

async function createUser(request, admin, email) {
  const res = await request.post('/api/users', {
    headers: admin.headers,
    data: {
      email, password: 'SecTest_Pass123!',
      firstName: 'Sec', lastName: 'Test', role: 'mitarbeiter',
      companyId: admin.user.companyId,
    },
  });
  expect([201, 400]).toContain(res.status()); // 400 = existiert bereits (Re-Run)
  return { email, password: 'SecTest_Pass123!' };
}

test.describe('Security-Härtung', () => {
  test('Konto-Sperre nach zu vielen Fehlversuchen (429 ACCOUNT_LOCKED)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const u = await createUser(request, admin, 'sec-lock@timefeed.de');

    // 5 Fehlversuche (Default maxLoginAttempts=5) → jeweils 401.
    for (let i = 1; i <= 5; i++) {
      const res = await request.post('/api/auth/login', {
        data: { email: u.email, password: 'falsch' },
      });
      expect(res.status(), `Fehlversuch ${i}`).toBe(401);
    }
    // 6. Versuch (auch mit RICHTIGEM Passwort) → gesperrt.
    const locked = await request.post('/api/auth/login', {
      data: { email: u.email, password: u.password },
    });
    expect(locked.status()).toBe(429);
    const body = await locked.json();
    expect(body.code).toBe('ACCOUNT_LOCKED');
  });

  test('Token-Widerruf: logout-all entwertet bestehende Tokens', async ({ request }) => {
    const admin = await login(request, 'admin');
    const u = await createUser(request, admin, 'sec-revoke@timefeed.de');

    const first = await login(request, u);
    // Token funktioniert.
    const me1 = await request.get('/api/auth/me', { headers: first.headers });
    expect(me1.status()).toBe(200);

    // Auf allen Geräten abmelden → tokenVersion++.
    const out = await request.post('/api/auth/logout-all', { headers: first.headers });
    expect(out.status()).toBe(200);

    // Altes Token ist jetzt ungültig.
    const me2 = await request.get('/api/auth/me', { headers: first.headers });
    expect(me2.status()).toBe(401);

    // Neuer Login funktioniert wieder (neues Token trägt neue Version).
    const second = await login(request, u);
    const me3 = await request.get('/api/auth/me', { headers: second.headers });
    expect(me3.status()).toBe(200);
  });

  test('Session-Dauer aus Einstellungen steuert den JWT-Ablauf', async ({ request }) => {
    const admin = await login(request, 'admin');
    const u = await createUser(request, admin, 'sec-session@timefeed.de');

    // Als (Super-)Admin die Session-Dauer setzen (Standard-Scope = eigene Firma).
    const put = await request.put('/api/settings', {
      headers: admin.headers,
      data: { sessionDurationHours: 100 },
    });
    expect(put.ok()).toBeTruthy();

    const { token } = await login(request, u);
    const p = decodeJwt(token);
    // exp − iat entspricht exakt der konfigurierten Dauer (100 h in Sekunden).
    expect(p.exp - p.iat).toBe(100 * 3600);

    // Aufräumen: zurück auf 8 h, damit andere Specs normale Laufzeiten sehen.
    await request.put('/api/settings', {
      headers: admin.headers,
      data: { sessionDurationHours: 8 },
    });
  });

  test('Passwort-Policy aus Einstellungen wird serverseitig erzwungen', async ({ request }) => {
    const admin = await login(request, 'admin');

    // Strenge Policy: min. 10 Zeichen, alle Zeichenklassen erforderlich.
    let put = await request.put('/api/settings', {
      headers: admin.headers,
      data: {
        passwordMinLength: 10, passwordRequireUppercase: true, passwordRequireLowercase: true,
        passwordRequireNumbers: true, passwordRequireSpecialChars: true,
      },
    });
    expect(put.ok()).toBeTruthy();

    // Passwort ohne Großbuchstabe → serverseitig abgelehnt (400 Validierung).
    const weak = await request.post('/api/users', {
      headers: admin.headers,
      data: {
        email: 'pw-weak@timefeed.de', password: 'kleinklein12!',
        firstName: 'Pw', lastName: 'Weak', role: 'mitarbeiter', companyId: admin.user.companyId,
      },
    });
    expect(weak.status()).toBe(400);

    // Policy lockern: min. 6, keine Zeichenklassen erzwungen.
    put = await request.put('/api/settings', {
      headers: admin.headers,
      data: {
        passwordMinLength: 6, passwordRequireUppercase: false, passwordRequireLowercase: false,
        passwordRequireNumbers: false, passwordRequireSpecialChars: false,
      },
    });
    expect(put.ok()).toBeTruthy();

    // Jetzt ist dasselbe (nun regelkonforme) einfache Passwort zulässig.
    const okRes = await request.post('/api/users', {
      headers: admin.headers,
      data: {
        email: 'pw-lax@timefeed.de', password: 'simple',
        firstName: 'Pw', lastName: 'Lax', role: 'mitarbeiter', companyId: admin.user.companyId,
      },
    });
    expect([201, 400]).toContain(okRes.status()); // 201 neu, 400 nur bei Re-Run (existiert)
    if (okRes.status() === 400) {
      // Bei Re-Run existiert der User bereits — dann darf es NICHT an der Policy liegen.
      const body = await okRes.json();
      expect(JSON.stringify(body)).not.toContain('Passwort');
    }

    // Aufräumen: Standard-Policy wiederherstellen.
    await request.put('/api/settings', {
      headers: admin.headers,
      data: {
        passwordMinLength: 8, passwordRequireUppercase: true, passwordRequireLowercase: true,
        passwordRequireNumbers: true, passwordRequireSpecialChars: true,
      },
    });
  });
});
