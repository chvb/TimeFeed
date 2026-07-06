// @ts-check
const { test, expect } = require('@playwright/test');
const { login, TEST_USERS } = require('./helpers');

async function findUserId(request, headers, email) {
  const data = await (await request.get('/api/users', { headers })).json();
  const u = data.users.find((x) => x.email === email);
  return u && u.id;
}

// Liefert Fr–Mo (4 Kalendertage, 2 Werktage) weit in der Zukunft.
function weekendSpanningRange() {
  const d = new Date();
  // Weit außerhalb des Zufallsfensters anderer Tests (300–1100), um Overlaps zu vermeiden.
  d.setUTCDate(d.getUTCDate() + 1300);
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1); // bis Freitag
  const start = d.toISOString().slice(0, 10);
  const e = new Date(d);
  e.setUTCDate(e.getUTCDate() + 3); // Montag
  return { startDate: start, endDate: e.toISOString().slice(0, 10) };
}

test.describe('Audit-Fixes', () => {
  test('Unbekannter /api-Pfad → 404 (kein Hänger)', async ({ request }) => {
    const res = await request.get('/api/gibt-es-nicht-xyz');
    expect(res.status()).toBe(404);
  });

  test('Admin kann eigenen Account nicht löschen (400)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const res = await request.delete(`/api/users/${admin.user.id}`, { headers: admin.headers });
    expect(res.status()).toBe(400);
  });

  test('Direkteintrag über ein Wochenende zählt nur Werktage (nicht Kalendertage)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const empId = await findUserId(request, admin.headers, TEST_USERS.employee.email);
    expect(empId).toBeTruthy();

    const range = weekendSpanningRange();
    const res = await request.post('/api/vacations/direct-entry', {
      headers: admin.headers,
      data: { userId: empId, ...range, type: 'vacation', durationType: 'full_day' },
    });
    expect(res.status()).toBe(201);
    const vac = (await res.json()).vacation;
    // Fr–Mo = 4 Kalendertage; Werktage (ohne Sa/So) müssen < 4 sein (Bugfix).
    expect(Number(vac.days)).toBeLessThan(4);
    expect(Number(vac.days)).toBeGreaterThanOrEqual(1);

    // Aufräumen: stornieren (bucht Saldo zurück), damit kein Datenmüll bleibt.
    const cancel = await request.post(`/api/vacations/${vac.id}/cancel`, { headers: admin.headers });
    expect(cancel.ok()).toBeTruthy();
    await request.delete(`/api/vacations/${vac.id}`, { headers: admin.headers });
  });

  test('Changelog-Endpoint liefert Einträge (öffentlich, kein Auth)', async ({ request }) => {
    const res = await request.get('/api/changelog');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    expect(Array.isArray(data.entries)).toBeTruthy();
    expect(data.entries.length).toBeGreaterThan(0);
    expect(data.entries[0].version).toBeTruthy();
    expect(Array.isArray(data.entries[0].sections)).toBeTruthy();
  });

  test('S3-Restore mit Pfad-Traversal-Key → 400', async ({ request }) => {
    const admin = await login(request, 'admin');
    const res = await request.post('/api/storage/backups/restore', {
      headers: admin.headers,
      data: { key: '../../etc/passwd' },
    });
    expect(res.status()).toBe(400);
  });
});
