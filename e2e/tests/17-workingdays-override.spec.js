// @ts-check
const { test, expect } = require('@playwright/test');
const { login, uniq } = require('./helpers');

// 7 aufeinanderfolgende Tage weit in der Zukunft (enthält genau eine volle Woche).
function weekRange() {
  const s = new Date(); s.setUTCDate(s.getUTCDate() + 90);
  const e = new Date(s); e.setUTCDate(s.getUTCDate() + 6);
  return { startDate: s.toISOString().slice(0, 10), endDate: e.toISOString().slice(0, 10) };
}

async function createUser(request, headers, extra) {
  const r = await request.post('/api/users', {
    headers,
    data: { email: `e2e-wd-${uniq()}@test.local`, password: 'TempPassw0rd!', firstName: 'WD', lastName: 'Test', role: 'employee', ...extra },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).user;
}

test.describe('Individuelle Arbeitstage (Override)', () => {
  test('Override wird gespeichert und zurückgelesen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const u = await createUser(request, admin.headers, { workingDaysOverride: ['monday', 'tuesday'] });
    const got = (await (await request.get(`/api/users/${u.id}`, { headers: admin.headers })).json()).user;
    expect(Array.isArray(got.workingDaysOverride)).toBeTruthy();
    expect(got.workingDaysOverride).toEqual(['monday', 'tuesday']);
    await request.delete(`/api/users/${u.id}`, { headers: admin.headers });
  });

  test('Override beeinflusst die Werktageberechnung', async ({ request }) => {
    const admin = await login(request, 'admin');
    const range = weekRange();
    const all7 = await createUser(request, admin.headers, { workingDaysOverride: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'] });
    const def = await createUser(request, admin.headers, {}); // global (Mo–Fr)

    const deA = await request.post('/api/vacations/direct-entry', { headers: admin.headers, data: { userId: all7.id, ...range, type: 'vacation', durationType: 'full_day' } });
    const deB = await request.post('/api/vacations/direct-entry', { headers: admin.headers, data: { userId: def.id, ...range, type: 'vacation', durationType: 'full_day' } });
    expect(deA.status()).toBe(201);
    expect(deB.status()).toBe(201);
    const daysA = Number((await deA.json()).vacation.days);
    const daysB = Number((await deB.json()).vacation.days);
    // 7-Tage-Bereich: alle Tage zählen → mehr als Mo–Fr (Differenz = 2 Wochenendtage, unabh. von Feiertagen).
    expect(daysA).toBeGreaterThan(daysB);
    expect(daysA - daysB).toBe(2);

    await request.delete(`/api/users/${all7.id}`, { headers: admin.headers });
    await request.delete(`/api/users/${def.id}`, { headers: admin.headers });
  });
});
