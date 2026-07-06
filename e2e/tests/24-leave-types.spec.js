// @ts-check
const { test, expect } = require('@playwright/test');
const { login, futureRange } = require('./helpers');

test.describe.configure({ mode: 'serial' });

test.describe('Eigene Abwesenheitsarten', () => {
  test('Built-ins vorhanden, eigene Art anlegen, requiresApproval=false → Auto-Genehmigung', async ({ request }) => {
    const admin = await login(request, 'admin');
    const emp = await login(request, 'employee');

    const all = await request.get('/api/leave-types', { headers: admin.headers });
    expect(all.ok()).toBeTruthy();
    const list = (await all.json()).leaveTypes;
    const builtin = list.find((t) => t.isBuiltin);
    expect(builtin).toBeTruthy();
    expect(list.find((t) => t.key === 'vacation')?.deductsBalance).toBe(true);

    // Built-in löschen → 400
    const delBuiltin = await request.delete(`/api/leave-types/${builtin.id}`, { headers: admin.headers });
    expect(delBuiltin.status()).toBe(400);

    // Eigene Art: kein Konto-Abzug, keine Genehmigung nötig
    const created = await request.post('/api/leave-types', {
      headers: admin.headers,
      data: { label: 'e2e Sonderurlaub', color: 'blue', deductsBalance: false, requiresApproval: false, requiresCertificate: false },
    });
    expect(created.status()).toBe(201);
    const lt = (await created.json()).leaveType;
    expect(lt.key).toBeTruthy();

    // Mitarbeiter beantragt diese Art → direkt genehmigt
    const range = futureRange(210, 2);
    const req = await request.post('/api/vacations', { headers: emp.headers, data: { ...range, type: lt.key } });
    expect(req.status()).toBe(201);
    const v = (await req.json()).vacation;
    expect(v.status).toBe('approved');

    // Aufräumen (genehmigte Anträge werden storniert, nicht gelöscht)
    await request.post(`/api/vacations/${v.id}/cancel`, { headers: admin.headers });
    await request.delete(`/api/leave-types/${lt.id}`, { headers: admin.headers });
  });

  test('Liste für Mitarbeiter abrufbar; Anlegen nur Admin/HR', async ({ request }) => {
    const emp = await login(request, 'employee');
    expect((await request.get('/api/leave-types', { headers: emp.headers })).ok()).toBeTruthy();
    const res = await request.post('/api/leave-types', { headers: emp.headers, data: { label: 'x' } });
    expect(res.status()).toBe(403);
  });
});
