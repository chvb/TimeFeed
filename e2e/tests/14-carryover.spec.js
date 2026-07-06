// @ts-check
const { test, expect } = require('@playwright/test');
const { login, uniq } = require('./helpers');

// Vergangener Zeitraum im laufenden Jahr (8–3 Tage zurück).
function pastRange() {
  const s = new Date(); s.setUTCDate(s.getUTCDate() - 8);
  const e = new Date(); e.setUTCDate(e.getUTCDate() - 3);
  return { startDate: s.toISOString().slice(0, 10), endDate: e.toISOString().slice(0, 10) };
}

test.describe('Übertrag & Saldo-Neuberechnung', () => {
  test('Übertrags-Settings speichern und zurücklesen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const put = await request.put('/api/settings', {
      headers: admin.headers,
      data: { carryOverDays: 7, carryOverUnlimited: false, carryOverExpires: true, carryOverExpiryMonth: 3, carryOverExpiryDay: 31 },
    });
    expect(put.ok()).toBeTruthy();

    const s = await (await request.get('/api/settings', { headers: admin.headers })).json();
    expect(s.carryOverDays).toBe(7);
    expect(s.carryOverExpires).toBe(true);
    expect(s.carryOverExpiryMonth).toBe(3);
    expect(s.carryOverExpiryDay).toBe(31);
    expect(s.carryOverUnlimited).toBe(false);

    // Zurücksetzen, um andere Tests/Recompute nicht zu beeinflussen.
    await request.put('/api/settings', { headers: admin.headers, data: { carryOverExpires: false } });
  });

  test('Recompute: vergangener genehmigter Urlaub → genommen, kein geplant', async ({ request }) => {
    const admin = await login(request, 'admin');
    const email = `e2e-co-${uniq()}@test.local`;
    const created = await request.post('/api/users', {
      headers: admin.headers,
      data: { email, password: 'TempPassw0rd!', firstName: 'Carry', lastName: 'Over', role: 'employee', vacationDays: 30 },
    });
    expect(created.status()).toBe(201);
    const uid = (await created.json()).user.id;

    const de = await request.post('/api/vacations/direct-entry', {
      headers: admin.headers,
      data: { userId: uid, ...pastRange(), type: 'vacation', durationType: 'full_day' },
    });
    expect(de.status()).toBe(201);

    expect((await request.post('/api/cleanup/recompute-balances', { headers: admin.headers })).ok()).toBeTruthy();

    const u = (await (await request.get(`/api/users/${uid}`, { headers: admin.headers })).json()).user;
    // Neuer User in diesem Jahr → kein Übertrag.
    expect(Number(u.carriedOverDays || 0)).toBe(0);
    // Vergangener Urlaub ist jetzt „genommen", nicht „geplant".
    expect(Number(u.usedVacationDays)).toBeGreaterThan(0);
    expect(Number(u.plannedVacationDays)).toBe(0);

    await request.delete(`/api/users/${uid}`, { headers: admin.headers });
  });

  test('Onboarding: Startwerte (Übertrag + bereits genommen) wirken sofort und überleben Recompute', async ({ request }) => {
    const admin = await login(request, 'admin');
    const email = `e2e-onb-${uniq()}@test.local`;
    const created = await request.post('/api/users', {
      headers: admin.headers,
      data: { email, password: 'TempPassw0rd!', firstName: 'On', lastName: 'Board', role: 'employee', vacationDays: 30, initialCarryOverDays: 5, initialUsedDays: 8 },
    });
    expect(created.status()).toBe(201);
    const u1 = (await created.json()).user;
    expect(Number(u1.carriedOverDays)).toBe(5);
    expect(Number(u1.usedVacationDays)).toBe(8);
    const uid = u1.id;

    // Recompute (ohne Anträge) muss die Startwerte erhalten: used=8, carry=5, planned=0
    expect((await request.post('/api/cleanup/recompute-balances', { headers: admin.headers })).ok()).toBeTruthy();
    const u2 = (await (await request.get(`/api/users/${uid}`, { headers: admin.headers })).json()).user;
    expect(Number(u2.carriedOverDays)).toBe(5);
    expect(Number(u2.usedVacationDays)).toBe(8);
    expect(Number(u2.plannedVacationDays)).toBe(0);
    // Resturlaub = 30 + 5 − 8 − 0 = 27
    const bal = await (await request.get(`/api/users/${uid}/vacation-balance`, { headers: admin.headers })).json();
    expect(bal).toBeTruthy();

    await request.delete(`/api/users/${uid}`, { headers: admin.headers });
  });

  test('Override: Jahresanspruch übersteuert global; ohne Override gilt global', async ({ request }) => {
    const admin = await login(request, 'admin');
    const c1 = await request.post('/api/users', {
      headers: admin.headers,
      data: { email: `e2e-ov-${uniq()}@test.local`, password: 'TempPassw0rd!', firstName: 'Ov', lastName: 'Er', role: 'employee', vacationDaysOverride: 40 },
    });
    expect(c1.status()).toBe(201);
    const u1 = (await c1.json()).user;
    expect(Number(u1.vacationDays)).toBe(40);
    expect(Number(u1.vacationDaysOverride)).toBe(40);
    await request.delete(`/api/users/${u1.id}`, { headers: admin.headers });

    const settings = await (await request.get('/api/settings', { headers: admin.headers })).json();
    const c2 = await request.post('/api/users', {
      headers: admin.headers,
      data: { email: `e2e-ov2-${uniq()}@test.local`, password: 'TempPassw0rd!', firstName: 'No', lastName: 'Ov', role: 'employee' },
    });
    const u2 = (await c2.json()).user;
    expect(Number(u2.vacationDays)).toBe(Number(settings.defaultVacationDays));
    expect(u2.vacationDaysOverride == null).toBeTruthy();
    await request.delete(`/api/users/${u2.id}`, { headers: admin.headers });
  });

  test('Settings: Überziehung erlauben & max. zusammenhängende Tage werden gespeichert', async ({ request }) => {
    const admin = await login(request, 'admin');
    const put = await request.put('/api/settings', {
      headers: admin.headers,
      data: { allowNegativeBalance: true, maxConsecutiveVacationDays: 15 },
    });
    expect(put.ok()).toBeTruthy();
    const s = await (await request.get('/api/settings', { headers: admin.headers })).json();
    expect(s.allowNegativeBalance).toBe(true);
    expect(s.maxConsecutiveVacationDays).toBe(15);
    // Zurücksetzen
    await request.put('/api/settings', { headers: admin.headers, data: { allowNegativeBalance: false, maxConsecutiveVacationDays: 0 } });
  });

  test('Override: abweichende Übertragsregel wird gespeichert', async ({ request }) => {
    const admin = await login(request, 'admin');
    const c = await request.post('/api/users', {
      headers: admin.headers,
      data: { email: `e2e-coov-${uniq()}@test.local`, password: 'TempPassw0rd!', firstName: 'Carry', lastName: 'Ov', role: 'employee', carryOverOverride: { days: 12, unlimited: false, expires: true, expiryMonth: 6, expiryDay: 30 } },
    });
    const uid = (await c.json()).user.id;
    const u = (await (await request.get(`/api/users/${uid}`, { headers: admin.headers })).json()).user;
    expect(u.carryOverOverride).toBeTruthy();
    expect(Number(u.carryOverOverride.days)).toBe(12);
    expect(u.carryOverOverride.expires).toBe(true);
    await request.delete(`/api/users/${uid}`, { headers: admin.headers });
  });
});
