// @ts-check
// Security-Basics: Header (Helmet/CSP), unauthentifizierte API → 401, 404-Handling,
// Rate-Limit-Header (inkl. Localhost-Ausnahme des Auth-Limiters), Terminal-Token-Auth.
const { test, expect } = require('@playwright/test');
const { USERS } = require('./helpers');

test.describe('Security: Header', () => {
  test('Helmet-Header sind gesetzt (CSP, nosniff, kein x-powered-by)', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.ok()).toBeTruthy();

    const headers = res.headers();
    const csp = headers['content-security-policy'] || '';
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(headers['x-content-type-options']).toBe('nosniff');
    expect(headers['x-powered-by']).toBeUndefined();
  });

  test('index.html wird nicht gecacht (Auto-Update nach Deploy)', async ({ request }) => {
    const res = await request.get('/');
    expect(res.ok()).toBeTruthy();
    expect(res.headers()['cache-control'] || '').toContain('no-store');
  });
});

test.describe('Security: Authentifizierung', () => {
  test('Unauthentifizierte API-Aufrufe → 401', async ({ request }) => {
    for (const path of ['/api/users', '/api/time/status', '/api/corrections', '/api/auth/me', '/api/terminals']) {
      const res = await request.get(path);
      expect(res.status(), `${path} muss 401 liefern`).toBe(401);
    }
  });

  test('Ungültiges Bearer-Token → 401', async ({ request }) => {
    const res = await request.get('/api/time/status', {
      headers: { Authorization: 'Bearer kein.echtes.token' },
    });
    expect(res.status()).toBe(401);
  });

  test('Terminal-API ohne/mit ungültigem Geräte-Token → 401', async ({ request }) => {
    const missing = await request.get('/api/terminal/info');
    expect(missing.status()).toBe(401);
    expect((await missing.json()).code).toBe('TERMINAL_TOKEN_REQUIRED');

    const invalid = await request.get('/api/terminal/info', {
      headers: { 'X-Terminal-Token': 'tft_definitiv_ungueltig' },
    });
    expect(invalid.status()).toBe(401);
    expect((await invalid.json()).code).toBe('TERMINAL_TOKEN_INVALID');
  });

  test('Selbstregistrierung ist deaktiviert → 403', async ({ request }) => {
    const res = await request.post('/api/auth/register', {
      data: {
        email: 'e2e-registrierung@timefeed.de',
        password: 'GutesPasswort123!',
        firstName: 'E2E',
        lastName: 'Register',
        role: 'admin',
      },
    });
    expect(res.status()).toBe(403);
  });
});

test.describe('Security: Robustheit', () => {
  test('Unbekannter API-Pfad → sauberes 404-JSON', async ({ request }) => {
    const res = await request.get('/api/gibt-es-nicht');
    expect(res.status()).toBe(404);
    expect((await res.json()).status).toBe('error');
  });

  test('Kaputte Login-Eingaben → 400/401, nie 500', async ({ request }) => {
    const injection = await request.post('/api/auth/login', {
      data: { email: "' OR 1=1 --", password: 'x' },
    });
    expect(injection.status()).toBe(400);

    const empty = await request.post('/api/auth/login', {
      data: { email: 'admin@timefeed.de', password: '' },
    });
    expect(empty.status()).toBe(400);
  });

  test('Rate-Limit-Header vorhanden; Auth-Limiter nimmt localhost aus', async ({ request }) => {
    // Allgemeiner /api-Limiter liefert standardisierte RateLimit-Header.
    const res = await request.get('/api/auth/me');
    const headers = res.headers();
    expect(headers['ratelimit-limit'] || headers['ratelimit-policy'] || headers['ratelimit'])
      .toBeTruthy();

    // Auth-Brute-Force-Limiter (max 30/15min) überspringt Loopback — die e2e-Suite
    // darf sich also nicht selbst aussperren: >30 Fehlversuche bleiben 401, nie 429.
    for (let i = 0; i < 32; i++) {
      const attempt = await request.post('/api/auth/login', {
        data: { email: USERS.mitarbeiter.email, password: `falsch-${i}!A1` },
      });
      expect(attempt.status()).toBe(401);
    }
  });
});
