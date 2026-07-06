// @ts-check
const { test, expect } = require('@playwright/test');
const { TEST_USERS, login, uniq, PASSWORD } = require('./helpers');

test.describe('Auth', () => {
  test('Health-Endpoint liefert OK', async ({ request }) => {
    const res = await request.get('/health');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(data.status).toBe('OK');
  });

  test('Login mit korrekten Credentials liefert Token', async ({ request }) => {
    const auth = await login(request, 'admin');
    expect(auth.token).toBeTruthy();
    expect(auth.user.email).toBe(TEST_USERS.admin.email);
    expect(auth.user.role).toBe('admin');
  });

  test('Login mit falschem Passwort → 401', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: TEST_USERS.admin.email, password: 'FalschesPasswort' },
    });
    expect(res.status()).toBe(401);
  });

  test('Login mit unbekannter E-Mail → 401', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: `nichtda-${uniq()}@test.local`, password: 'x' },
    });
    expect(res.status()).toBe(401);
  });

  test('Login ohne E-Mail → 400 (Validierung)', async ({ request }) => {
    const res = await request.post('/api/auth/login', { data: { password: 'x' } });
    expect(res.status()).toBe(400);
  });

  test('GET /api/users ohne Token → 401', async ({ request }) => {
    const res = await request.get('/api/users');
    expect(res.status()).toBe(401);
  });

  test('GET /api/users mit ungültigem Token → 401', async ({ request }) => {
    const res = await request.get('/api/users', { headers: { Authorization: 'Bearer ungueltig.token.wert' } });
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/me ohne Token → 401', async ({ request }) => {
    const res = await request.get('/api/auth/me');
    expect(res.status()).toBe(401);
  });

  test('GET /api/auth/me mit Token liefert eigenen User', async ({ request }) => {
    const auth = await login(request, 'employee');
    const res = await request.get('/api/auth/me', { headers: auth.headers });
    expect(res.ok()).toBeTruthy();
    expect((await res.json()).user.email).toBe(TEST_USERS.employee.email);
  });

  test('Logout mit Token → OK', async ({ request }) => {
    const auth = await login(request, 'employee');
    const res = await request.post('/api/auth/logout', { headers: auth.headers });
    expect(res.ok()).toBeTruthy();
  });

  test('Selbstregistrierung ist standardmäßig deaktiviert → 403', async ({ request }) => {
    // Sicherheits-Default: keine offene Registrierung (Mitarbeiter legt Admin/HR an).
    // Aktivierbar per ALLOW_SELF_REGISTRATION=true (dann gelten Validierung/Policy).
    const res = await request.post('/api/auth/register', {
      data: { email: `e2e-reg-${uniq()}@test.local`, password: 'Registr1erung!', firstName: 'Reg', lastName: 'User' },
    });
    expect(res.status()).toBe(403);

    // Sicherstellen, dass kein Account angelegt wurde (Login schlägt fehl).
    const li = await request.post('/api/auth/login', {
      data: { email: `e2e-reg-nonexist-${uniq()}@test.local`, password: 'Registr1erung!' },
    });
    expect(li.status()).toBe(401);
  });

  test('Passwort ändern: korrekt, dann mit falschem aktuellen Passwort → 401', async ({ request }) => {
    const admin = await login(request, 'admin');
    const email = `e2e-pw-${uniq()}@test.local`;
    // Temp-User anlegen
    const created = await request.post('/api/users', {
      headers: admin.headers,
      data: { email, password: PASSWORD, firstName: 'Pw', lastName: 'Test', role: 'employee', vacationDays: 10 },
    });
    expect(created.status()).toBe(201);

    // Als Temp-User einloggen und Passwort ändern
    const li = await request.post('/api/auth/login', { data: { email, password: PASSWORD } });
    const token = (await li.json()).token;
    const headers = { Authorization: `Bearer ${token}` };

    const ok = await request.post('/api/auth/change-password', {
      headers,
      data: { currentPassword: PASSWORD, newPassword: 'NeuesPw12345!' },
    });
    expect(ok.ok()).toBeTruthy();

    // Login mit neuem Passwort
    const li2 = await request.post('/api/auth/login', { data: { email, password: 'NeuesPw12345!' } });
    expect(li2.ok()).toBeTruthy();

    // Falsches aktuelles Passwort → 401
    const wrong = await request.post('/api/auth/change-password', {
      headers,
      data: { currentPassword: 'stimmtNicht', newPassword: 'EgalPw12345!' },
    });
    expect(wrong.status()).toBe(401);

    // aufräumen
    const id = (await created.json()).user.id;
    await request.delete(`/api/users/${id}`, { headers: admin.headers });
  });

  test('Forgot-Password verrät keine E-Mail-Existenz (immer 200)', async ({ request }) => {
    const existing = await request.post('/api/auth/forgot-password', {
      data: { email: TEST_USERS.employee.email },
    });
    const missing = await request.post('/api/auth/forgot-password', {
      data: { email: `gibtsnicht-${uniq()}@test.local` },
    });
    expect(existing.ok()).toBeTruthy();
    expect(missing.ok()).toBeTruthy();
    // Gleiche Antwort für existierend/nicht-existierend (kein Enumeration-Leak)
    expect((await existing.json()).message).toBe((await missing.json()).message);
  });

  test('Reset-Password mit ungültigem Token → Fehler (kein 2xx)', async ({ request }) => {
    const res = await request.post('/api/auth/reset-password', {
      data: { token: 'ungueltiger-token', newPassword: 'NeuesPw12345!' },
    });
    expect(res.ok()).toBeFalsy();
  });

  test('Deaktivierter Benutzer kann sich nicht einloggen → 401', async ({ request }) => {
    const admin = await login(request, 'admin');
    const email = `e2e-inactive-${uniq()}@test.local`;
    const created = await request.post('/api/users', {
      headers: admin.headers,
      data: { email, password: PASSWORD, firstName: 'In', lastName: 'Active', role: 'employee', vacationDays: 5 },
    });
    const id = (await created.json()).user.id;
    await request.post(`/api/users/${id}/deactivate`, { headers: admin.headers });

    const li = await request.post('/api/auth/login', { data: { email, password: PASSWORD } });
    expect(li.status()).toBe(401);

    await request.delete(`/api/users/${id}`, { headers: admin.headers });
  });
});
