// @ts-check
const { test, expect } = require('@playwright/test');
const { login, uniq } = require('./helpers');

async function createHoliday(request, headers, extra = {}) {
  return request.post('/api/holidays', {
    headers,
    data: { name: `e2e-holiday-${uniq()}`, date: '2030-12-24', type: 'company', applyToAll: false, ...extra },
  });
}

test.describe('Holidays', () => {
  test('Admin: Feiertag anlegen, lesen, ändern, löschen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const created = await createHoliday(request, admin.headers);
    expect(created.status()).toBe(201);
    const id = (await created.json()).holiday.id;

    expect(Array.isArray((await (await request.get('/api/holidays', { headers: admin.headers })).json()).holidays)).toBeTruthy();
    expect((await request.get(`/api/holidays/${id}`, { headers: admin.headers })).ok()).toBeTruthy();
    expect((await request.put(`/api/holidays/${id}`, { headers: admin.headers, data: { name: `e2e-holiday-${uniq()}` } })).ok()).toBeTruthy();
    expect((await request.delete(`/api/holidays/${id}`, { headers: admin.headers })).ok()).toBeTruthy();
  });

  test('Nationaler Feiertag anlegen (applyToAll:false)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const created = await createHoliday(request, admin.headers, { type: 'national', date: '2030-10-03' });
    expect(created.status()).toBe(201);
    await request.delete(`/api/holidays/${(await created.json()).holiday.id}`, { headers: admin.headers });
  });

  test('HR darf Feiertag anlegen', async ({ request }) => {
    const hr = await login(request, 'hr');
    const created = await createHoliday(request, hr.headers);
    expect(created.status()).toBe(201);
    await request.delete(`/api/holidays/${(await created.json()).holiday.id}`, { headers: hr.headers });
  });

  test('Feiertag mit ungültigem Datum → 400 (Validierung)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const res = await request.post('/api/holidays', {
      headers: admin.headers,
      data: { name: `e2e-holiday-${uniq()}`, date: 'kein-datum', type: 'company', applyToAll: false },
    });
    expect(res.status()).toBe(400);
  });

  test('Nicht existierender Feiertag → 404', async ({ request }) => {
    const admin = await login(request, 'admin');
    expect((await request.get('/api/holidays/999999999', { headers: admin.headers })).status()).toBe(404);
  });

  test('Employee darf keinen Feiertag anlegen → 403', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.post('/api/holidays', { headers: emp.headers, data: { name: `e2e-forbidden-${uniq()}`, date: '2030-01-01' } })).status()).toBe(403);
  });
});
