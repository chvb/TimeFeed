// @ts-check
const { test, expect } = require('@playwright/test');
const { login, uniq } = require('./helpers');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

function futureRange() {
  // 8-Tage-Spanne → enthält garantiert Werktage (unabhängig vom Wochentag).
  const s = new Date(); s.setUTCDate(s.getUTCDate() + 30);
  const e = new Date(s); e.setUTCDate(s.getUTCDate() + 7);
  return { startDate: s.toISOString().slice(0, 10), endDate: e.toISOString().slice(0, 10) };
}

test.describe('PDF-Anhänge an Urlaubsanträge', () => {
  test('Upload (PDF), Liste, Download und Löschen', async ({ request }) => {
    const admin = await login(request, 'admin');

    const cu = await request.post('/api/users', {
      headers: admin.headers,
      data: { email: `e2e-att-${uniq()}@test.local`, password: 'TempPassw0rd!', firstName: 'Att', lastName: 'Test', role: 'employee' },
    });
    const uid = (await cu.json()).user.id;

    const de = await request.post('/api/vacations/direct-entry', {
      headers: admin.headers,
      data: { userId: uid, ...futureRange(), type: 'vacation', durationType: 'full_day' },
    });
    expect(de.status()).toBe(201);

    // Antrags-ID robust ermitteln
    const all = await (await request.get('/api/vacations', { headers: admin.headers })).json();
    const list = all.vacations || all;
    const reqId = list.filter((v) => v.userId === uid).sort((a, b) => b.id - a.id)[0].id;

    // Upload (multipart – nur Authorization-Header, kein JSON-Content-Type)
    const up = await request.post(`/api/vacations/${reqId}/attachments`, {
      headers: { Authorization: admin.headers.Authorization },
      multipart: { file: { name: 'beleg.pdf', mimeType: 'application/pdf', buffer: PDF } },
    });
    expect(up.status()).toBe(201);
    const attId = (await up.json()).attachment.id;

    // Nicht-PDF wird abgelehnt
    const bad = await request.post(`/api/vacations/${reqId}/attachments`, {
      headers: { Authorization: admin.headers.Authorization },
      multipart: { file: { name: 'x.txt', mimeType: 'text/plain', buffer: Buffer.from('hallo') } },
    });
    expect(bad.status()).toBe(400);

    // Liste
    const listed = await (await request.get(`/api/vacations/${reqId}/attachments`, { headers: admin.headers })).json();
    expect(listed.attachments.length).toBe(1);
    expect(listed.attachments[0].fileName).toBe('beleg.pdf');

    // Download
    const dl = await request.get(`/api/vacations/attachments/${attId}/download`, { headers: admin.headers });
    expect(dl.ok()).toBeTruthy();
    expect(dl.headers()['content-type']).toContain('application/pdf');
    expect((await dl.body()).length).toBeGreaterThan(0);

    // Löschen
    const del = await request.delete(`/api/vacations/attachments/${attId}`, { headers: admin.headers });
    expect(del.ok()).toBeTruthy();
    const after = await (await request.get(`/api/vacations/${reqId}/attachments`, { headers: admin.headers })).json();
    expect(after.attachments.length).toBe(0);

    await request.delete(`/api/users/${uid}`, { headers: admin.headers });
  });
});
