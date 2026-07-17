// @ts-check
// Stempel-Standorte (Kartenansicht in /manage-times): der month-locations-Endpoint
// liefert geolokalisierte Stempelungen des Monats, ist auf Verwalter beschränkt und
// escaped nichts Sensibles. Prüft Rendering-Daten, Berechtigung und GPS-Übernahme.
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

async function createUser(request, admin, email) {
  const res = await request.post('/api/users', {
    headers: admin.headers,
    data: { email, password: 'MapTest_Pass123!', firstName: 'Map', lastName: 'Point', role: 'mitarbeiter', companyId: admin.user.companyId },
  });
  expect([201, 400]).toContain(res.status()); // 400 = existiert bereits (Re-Run)
  return { email, password: 'MapTest_Pass123!' };
}

test.describe('Stempel-Standorte (Karte)', () => {
  test('month-locations liefert geolokalisierte Stempelungen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const u = await createUser(request, admin, 'map-point@timefeed.de');
    const emp = await login(request, u);

    // Stempel „Kommen" mit GPS (Default-GPS-Modus = optional → wird gespeichert).
    const stamp = await request.post('/api/time/stamp', {
      headers: emp.headers,
      data: { type: 'in', lat: 51.1657, lng: 10.4515, accuracy: 12 },
    });
    expect([200, 201]).toContain(stamp.status());

    const month = new Date().toISOString().slice(0, 7);
    const res = await request.get('/api/time/month-locations', { headers: admin.headers, params: { month } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.points)).toBe(true);

    const mine = body.points.find((p) => Math.abs(p.lat - 51.1657) < 0.001 && Math.abs(p.lng - 10.4515) < 0.001);
    expect(mine, 'geolokalisierte Stempelung sollte in der Karte auftauchen').toBeTruthy();
    expect(mine.type).toBe('in');
    expect(mine.accuracy).toBe(12);
    expect(mine.name).toContain('Map');
  });

  test('month-locations kann auf einen Mitarbeiter eingegrenzt werden', async ({ request }) => {
    const admin = await login(request, 'admin');
    const u = await createUser(request, admin, 'map-point@timefeed.de');
    const emp = await login(request, u);
    // eigene userId ermitteln
    const me = await (await request.get('/api/auth/me', { headers: emp.headers })).json();
    const uid = me.user?.id ?? me.id;

    const month = new Date().toISOString().slice(0, 7);
    const res = await request.get('/api/time/month-locations', { headers: admin.headers, params: { month, userId: uid } });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.points.every((p) => p.userId === uid)).toBe(true);
  });

  test('Mitarbeiter darf month-locations nicht abrufen (403)', async ({ request }) => {
    const emp = await login(request, 'mitarbeiter');
    const month = new Date().toISOString().slice(0, 7);
    const res = await request.get('/api/time/month-locations', { headers: emp.headers, params: { month } });
    expect(res.status()).toBe(403);
  });
});
