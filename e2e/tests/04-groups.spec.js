// @ts-check
const { test, expect } = require('@playwright/test');
const { login, uniq, TEST_USERS } = require('./helpers');

async function findUserId(request, headers, email) {
  const data = await (await request.get('/api/users', { headers })).json();
  const u = data.users.find((x) => x.email === email);
  return u && u.id;
}

async function createGroup(request, headers) {
  const res = await request.post('/api/groups', { headers, data: { name: `e2e-group-${uniq()}`, description: 'e2e' } });
  return (await res.json()).group.id;
}

test.describe('Groups', () => {
  test('Admin: Gruppe anlegen, lesen, Mitglied hinzufügen/entfernen, ändern, löschen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const id = await createGroup(request, admin.headers);

    expect(Array.isArray((await (await request.get('/api/groups', { headers: admin.headers })).json()).groups)).toBeTruthy();
    expect((await request.get(`/api/groups/${id}`, { headers: admin.headers })).ok()).toBeTruthy();

    const userId = await findUserId(request, admin.headers, TEST_USERS.employee.email);
    expect((await request.post(`/api/groups/${id}/members`, { headers: admin.headers, data: { userId } })).ok()).toBeTruthy();
    expect((await request.get(`/api/groups/${id}/members`, { headers: admin.headers })).ok()).toBeTruthy();
    expect((await request.delete(`/api/groups/${id}/members/${userId}`, { headers: admin.headers })).ok()).toBeTruthy();

    expect((await request.put(`/api/groups/${id}`, { headers: admin.headers, data: { description: 'geändert' } })).ok()).toBeTruthy();
    expect((await request.delete(`/api/groups/${id}`, { headers: admin.headers })).ok()).toBeTruthy();
  });

  test('Gruppe mit Mitgliedern kann nicht gelöscht werden → 400', async ({ request }) => {
    const admin = await login(request, 'admin');
    const id = await createGroup(request, admin.headers);
    const userId = await findUserId(request, admin.headers, TEST_USERS.employee.email);
    await request.post(`/api/groups/${id}/members`, { headers: admin.headers, data: { userId } });

    expect((await request.delete(`/api/groups/${id}`, { headers: admin.headers })).status()).toBe(400);

    // aufräumen: Mitglied entfernen, dann löschen
    await request.delete(`/api/groups/${id}/members/${userId}`, { headers: admin.headers });
    await request.delete(`/api/groups/${id}`, { headers: admin.headers });
  });

  test('Doppeltes Mitglied hinzufügen → 400', async ({ request }) => {
    const admin = await login(request, 'admin');
    const id = await createGroup(request, admin.headers);
    const userId = await findUserId(request, admin.headers, TEST_USERS.employee.email);
    await request.post(`/api/groups/${id}/members`, { headers: admin.headers, data: { userId } });
    expect((await request.post(`/api/groups/${id}/members`, { headers: admin.headers, data: { userId } })).status()).toBe(400);
    await request.delete(`/api/groups/${id}/members/${userId}`, { headers: admin.headers });
    await request.delete(`/api/groups/${id}`, { headers: admin.headers });
  });

  test('Nicht-Mitglied entfernen → 400', async ({ request }) => {
    const admin = await login(request, 'admin');
    const id = await createGroup(request, admin.headers);
    const userId = await findUserId(request, admin.headers, TEST_USERS.manager.email);
    expect((await request.delete(`/api/groups/${id}/members/${userId}`, { headers: admin.headers })).status()).toBe(400);
    await request.delete(`/api/groups/${id}`, { headers: admin.headers });
  });

  test('Nicht existierende Gruppe → 404', async ({ request }) => {
    const admin = await login(request, 'admin');
    expect((await request.get('/api/groups/999999999', { headers: admin.headers })).status()).toBe(404);
  });

  test('Manager darf nur EIGENE Gruppen ändern, fremde nicht, und keine anlegen', async ({ request }) => {
    const admin = await login(request, 'admin');
    const mgr = await login(request, 'manager');
    const mgrId = await findUserId(request, admin.headers, TEST_USERS.manager.email);

    // Eigene Gruppe (managerId = Manager) → darf ändern
    const own = await request.post('/api/groups', { headers: admin.headers, data: { name: `e2e-group-${uniq()}`, managerId: mgrId } });
    const ownId = (await own.json()).group.id;
    expect((await request.put(`/api/groups/${ownId}`, { headers: mgr.headers, data: { description: 'mgr' } })).ok()).toBeTruthy();

    // Fremde Gruppe (kein managerId) → 403
    const foreignId = await createGroup(request, admin.headers);
    expect((await request.put(`/api/groups/${foreignId}`, { headers: mgr.headers, data: { description: 'x' } })).status()).toBe(403);

    // Manager darf keine Gruppe anlegen → 403
    expect((await request.post('/api/groups', { headers: mgr.headers, data: { name: `e2e-group-${uniq()}` } })).status()).toBe(403);

    await request.delete(`/api/groups/${ownId}`, { headers: admin.headers });
    await request.delete(`/api/groups/${foreignId}`, { headers: admin.headers });
  });

  test('Employee darf keine Gruppe anlegen → 403', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.post('/api/groups', { headers: emp.headers, data: { name: `e2e-forbidden-${uniq()}` } })).status()).toBe(403);
  });
});
