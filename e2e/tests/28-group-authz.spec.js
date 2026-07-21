// @ts-check
// Zugriffsschutz der Gruppen-Leseendpunkte: nach dem Review-Fix dürfen nur
// Verwalter-Rollen (admin/buchhaltung/verwaltung) die Gruppenliste/-details mit
// Kollegen-E-Mails und -Rollen lesen — ein Mitarbeiter nicht mehr.
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('Gruppen-Leseendpunkte: Rollen-Gate', () => {
  test('Mitarbeiter darf Gruppenliste/-detail NICHT lesen (403)', async ({ request }) => {
    const emp = await login(request, 'mitarbeiter');
    const list = await request.get('/api/groups', { headers: emp.headers });
    expect(list.status()).toBe(403);
  });

  test('Admin darf Gruppenliste lesen (200)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const list = await request.get('/api/groups', { headers: admin.headers });
    expect(list.status()).toBe(200);
    const groups = (await list.json()).groups;
    expect(Array.isArray(groups)).toBe(true);
    if (groups.length > 0) {
      const detail = await request.get(`/api/groups/${groups[0].id}`, { headers: admin.headers });
      expect(detail.status()).toBe(200);
      // Mitarbeiter erhält denselben Detailpfad nicht.
      const emp = await login(request, 'mitarbeiter');
      const denied = await request.get(`/api/groups/${groups[0].id}`, { headers: emp.headers });
      expect(denied.status()).toBe(403);
    }
  });
});
