// @ts-check
const { test, expect } = require('@playwright/test');
const { login, futureRange } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test.describe('Papierkorb', () => {
  test('Löschen → Papierkorb → Wiederherstellen → endgültig löschen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const name = `e2e-trash-${Date.now()}`;

    // Sperrzeit anlegen
    const c = await request.post('/api/blackouts', { headers: admin.headers, data: { name, startDate: '2031-01-01', endDate: '2031-01-05' } });
    expect(c.status()).toBe(201);
    const id = (await c.json()).blackout.id;

    // Löschen → landet im Papierkorb
    expect((await request.delete(`/api/blackouts/${id}`, { headers: admin.headers })).ok()).toBeTruthy();

    const trash = await request.get('/api/trash', { headers: admin.headers });
    expect(trash.ok()).toBeTruthy();
    const entry = (await trash.json()).items.find((i) => i.entityType === 'BlackoutPeriod' && i.label === name);
    expect(entry).toBeTruthy();
    expect(entry.daysRemaining).toBeGreaterThan(25);

    // Wiederherstellen
    expect((await request.post(`/api/trash/${entry.id}/restore`, { headers: admin.headers })).ok()).toBeTruthy();
    const list = await (await request.get('/api/blackouts', { headers: admin.headers })).json();
    expect(list.blackouts.find((b) => b.id === id)).toBeTruthy();

    // erneut löschen + endgültig aus Papierkorb entfernen
    await request.delete(`/api/blackouts/${id}`, { headers: admin.headers });
    const t2 = await (await request.get('/api/trash', { headers: admin.headers })).json();
    const e2 = t2.items.find((i) => i.entityType === 'BlackoutPeriod' && i.label === name);
    expect((await request.delete(`/api/trash/${e2.id}`, { headers: admin.headers })).ok()).toBeTruthy();
  });

  test('Mitarbeiter inkl. Abwesenheits-Historie wiederherstellen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const email = `trash-emp-${Date.now()}@test.local`;
    const cu = await request.post('/api/users', { headers: admin.headers, data: { email, password: 'Test1234!', firstName: 'Trash', lastName: 'Emp', role: 'employee', vacationDays: 25 } });
    expect(cu.status()).toBe(201);
    const uid = (await cu.json()).user.id;

    // Als Mitarbeiter eine Abwesenheit anlegen
    const lr = await request.post('/api/auth/login', { data: { email, password: 'Test1234!' } });
    const token = (await lr.json()).token;
    const empHeaders = { Authorization: `Bearer ${token}` };
    const range = futureRange(220, 2);
    const v = await request.post('/api/vacations', { headers: empHeaders, data: { ...range, type: 'vacation' } });
    expect(v.status()).toBe(201);
    const vid = (await v.json()).vacation.id;

    // Admin löscht den Mitarbeiter → Mitarbeiter + Historie in den Papierkorb
    expect((await request.delete(`/api/users/${uid}`, { headers: admin.headers })).ok()).toBeTruthy();

    const trash = await (await request.get('/api/trash', { headers: admin.headers })).json();
    const entry = trash.items.find((i) => i.entityType === 'User' && i.label === 'Trash Emp');
    expect(entry).toBeTruthy();

    // Wiederherstellen → Mitarbeiter UND seine Abwesenheit sind zurück
    expect((await request.post(`/api/trash/${entry.id}/restore`, { headers: admin.headers })).ok()).toBeTruthy();
    expect((await request.get(`/api/users/${uid}`, { headers: admin.headers })).ok()).toBeTruthy();
    const list = await (await request.get(`/api/vacations?userId=${uid}`, { headers: admin.headers })).json();
    const vacs = list.vacations || list;
    expect(vacs.find((x) => x.id === vid)).toBeTruthy();

    // Aufräumen
    await request.delete(`/api/users/${uid}`, { headers: admin.headers });
    const t2 = await (await request.get('/api/trash', { headers: admin.headers })).json();
    const e2 = t2.items.find((i) => i.entityType === 'User' && i.label === 'Trash Emp');
    if (e2) await request.delete(`/api/trash/${e2.id}`, { headers: admin.headers });
  });

  test('Papierkorb nur für Admin/HR', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.get('/api/trash', { headers: emp.headers })).status()).toBe(403);
  });
});
