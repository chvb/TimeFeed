// @ts-check
// AVV/AGB pro Mandant: Vertragsdaten am Mandanten pflegen und die gerenderten
// Rechtsdokumente (Auftragsverarbeitungsvertrag / AGB) abrufen. Prüft Rendering,
// Platzhalter-Ersetzung, HTML-Escaping (Stored-XSS-Schutz) und die Berechtigung
// (nur Super-Admin).
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('Mandant AVV/AGB', () => {
  test('Vertragsdaten speichern + AVV/AGB rendern (Platzhalter, Escaping)', async ({ request }) => {
    const admin = await login(request, 'admin');

    // Ersten Mandanten ermitteln.
    const list = await request.get('/api/tenants', { headers: admin.headers });
    expect(list.status()).toBe(200);
    const tenants = (await list.json()).tenants;
    expect(tenants.length).toBeGreaterThan(0);
    const tid = tenants[0].id;

    // Vertragsdaten setzen — inkl. XSS-Nutzlast im Vertreter-Feld.
    const put = await request.put(`/api/tenants/${tid}`, {
      headers: admin.headers,
      data: {
        contractData: {
          companyName: 'E2E Muster GmbH',
          city: 'Köln',
          postalCode: '50667',
          legalRepresentative: '<script>alert(1)</script>Max',
          jurisdiction: 'Kleve',
        },
      },
    });
    expect(put.status()).toBe(200);
    expect((await put.json()).contractData.companyName).toBe('E2E Muster GmbH');

    // AVV rendern.
    const avv = await request.get(`/api/tenants/${tid}/legal/avv`, { headers: admin.headers });
    expect(avv.status()).toBe(200);
    const avvBody = await avv.json();
    expect(avvBody.title).toContain('Auftragsverarbeitung');
    expect(avvBody.html).toContain('E2E Muster GmbH');
    // XSS-Nutzlast muss escaped sein — kein rohes <script> im Output.
    expect(avvBody.html).not.toContain('<script>alert(1)</script>');
    expect(avvBody.html).toContain('&lt;script&gt;');

    // AGB rendern.
    const agb = await request.get(`/api/tenants/${tid}/legal/agb`, { headers: admin.headers });
    expect(agb.status()).toBe(200);
    expect((await agb.json()).title).toContain('Geschäftsbedingungen');
  });

  test('Unbekanntes Dokument → 404', async ({ request }) => {
    const admin = await login(request, 'admin');
    const tenants = (await (await request.get('/api/tenants', { headers: admin.headers })).json()).tenants;
    const res = await request.get(`/api/tenants/${tenants[0].id}/legal/foobar`, { headers: admin.headers });
    expect(res.status()).toBe(404);
  });

  test('Nicht-Super-Admin darf AVV/AGB nicht abrufen (403)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const tenants = (await (await request.get('/api/tenants', { headers: admin.headers })).json()).tenants;
    const tid = tenants[0].id;

    const mitarbeiter = await login(request, 'mitarbeiter');
    const res = await request.get(`/api/tenants/${tid}/legal/avv`, { headers: mitarbeiter.headers });
    expect(res.status()).toBe(403);
  });
});
