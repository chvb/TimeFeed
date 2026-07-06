// @ts-check
const { test, expect } = require('@playwright/test');
const { login, futureRange, TEST_USERS } = require('./helpers');

async function findUserId(request, headers, email) {
  const data = await (await request.get('/api/users', { headers })).json();
  const u = data.users.find((x) => x.email === email);
  return u && u.id;
}

function range() {
  return futureRange(200 + Math.floor(Math.random() * 600), 2);
}

test.describe('Sick leaves', () => {
  test('Admin: Krankmeldung anlegen, lesen, ändern, löschen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const userId = await findUserId(request, admin.headers, TEST_USERS.employee.email);
    const r = range();
    const created = await request.post('/api/sick-leaves', { headers: admin.headers, data: { userId, startDate: r.startDate, endDate: r.endDate, notes: 'e2e' } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).sickLeave.id;

    expect(Array.isArray((await (await request.get('/api/sick-leaves', { headers: admin.headers })).json()).sickLeaves)).toBeTruthy();
    expect((await request.get(`/api/sick-leaves/${id}`, { headers: admin.headers })).ok()).toBeTruthy();
    expect((await request.put(`/api/sick-leaves/${id}`, { headers: admin.headers, data: { notes: 'geändert', certificateSubmitted: true } })).ok()).toBeTruthy();
    expect((await request.delete(`/api/sick-leaves/${id}`, { headers: admin.headers })).ok()).toBeTruthy();
  });

  test('HR darf Krankmeldung anlegen, Manager darf Liste sehen', async ({ request }) => {
    const hr = await login(request, 'hr');
    const userId = await findUserId(request, hr.headers, TEST_USERS.employee.email);
    const r = range();
    const created = await request.post('/api/sick-leaves', { headers: hr.headers, data: { userId, startDate: r.startDate, endDate: r.endDate } });
    expect(created.status()).toBe(201);

    const mgr = await login(request, 'manager');
    expect((await request.get('/api/sick-leaves', { headers: mgr.headers })).ok()).toBeTruthy();

    await request.delete(`/api/sick-leaves/${(await created.json()).sickLeave.id}`, { headers: hr.headers });
  });

  test('Anlegen ohne userId → 400 (Validierung)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const r = range();
    expect((await request.post('/api/sick-leaves', { headers: admin.headers, data: { startDate: r.startDate, endDate: r.endDate } })).status()).toBe(400);
  });

  test('Eigene Krankmeldungen abrufbar (/user/:userId)', async ({ request }) => {
    const emp = await login(request, 'employee');
    const res = await request.get(`/api/sick-leaves/user/${emp.user.id}`, { headers: emp.headers });
    expect(res.ok()).toBeTruthy();
    expect(Array.isArray((await res.json()).sickLeaves)).toBeTruthy();
  });

  test('Nicht existierende Krankmeldung → 404', async ({ request }) => {
    const admin = await login(request, 'admin');
    expect((await request.get('/api/sick-leaves/999999999', { headers: admin.headers })).status()).toBe(404);
  });

  test('Employee darf Krankmeldungs-Liste NICHT sehen → 403', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.get('/api/sick-leaves', { headers: emp.headers })).status()).toBe(403);
  });
});
