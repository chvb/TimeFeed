// @ts-check
const { test, expect } = require('@playwright/test');
const { login, uniq } = require('./helpers');

test.describe('Departments', () => {
  test('Admin: Abteilung anlegen, listen, ändern, löschen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const created = await request.post('/api/departments', { headers: admin.headers, data: { name: `e2e-dept-${uniq()}`, description: 'e2e' } });
    expect(created.status()).toBe(201);
    const id = (await created.json()).id;

    expect(Array.isArray(await (await request.get('/api/departments', { headers: admin.headers })).json())).toBeTruthy();
    expect((await request.put(`/api/departments/${id}`, { headers: admin.headers, data: { name: `e2e-dept-${uniq()}` } })).ok()).toBeTruthy();
    expect((await request.delete(`/api/departments/${id}`, { headers: admin.headers })).ok()).toBeTruthy();
  });

  test('HR darf Abteilung anlegen', async ({ request }) => {
    const hr = await login(request, 'hr');
    const created = await request.post('/api/departments', { headers: hr.headers, data: { name: `e2e-dept-${uniq()}` } });
    expect(created.status()).toBe(201);
    await request.delete(`/api/departments/${(await created.json()).id}`, { headers: hr.headers });
  });

  test('Doppelter Abteilungsname → 400', async ({ request }) => {
    const admin = await login(request, 'admin');
    const name = `e2e-dept-${uniq()}`;
    const first = await request.post('/api/departments', { headers: admin.headers, data: { name } });
    expect(first.status()).toBe(201);
    const second = await request.post('/api/departments', { headers: admin.headers, data: { name } });
    expect(second.status()).toBe(400);
    await request.delete(`/api/departments/${(await first.json()).id}`, { headers: admin.headers });
  });

  test('Abteilung ohne Namen → 400 (Validierung)', async ({ request }) => {
    const admin = await login(request, 'admin');
    expect((await request.post('/api/departments', { headers: admin.headers, data: { description: 'ohne name' } })).status()).toBe(400);
  });

  test('Employee darf keine Abteilung anlegen → 403', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.post('/api/departments', { headers: emp.headers, data: { name: `e2e-forbidden-${uniq()}` } })).status()).toBe(403);
  });

  test('Abteilungen ohne Token → 401', async ({ request }) => {
    expect((await request.get('/api/departments')).status()).toBe(401);
  });
});
