// @ts-check
const { test, expect } = require('@playwright/test');
const { login, futureRange } = require('./helpers');

test.describe('Persönlicher Antrags-QR-Code', () => {
  test('Admin erzeugt QR, Mitarbeiter reicht per Token ohne Login ein', async ({ request }) => {
    const admin = await login(request, 'admin');
    const usersRes = await request.get('/api/users', { headers: admin.headers });
    const users = (await usersRes.json()).users || (await usersRes.json());
    const emp = (Array.isArray(users) ? users : []).find((u) => u.role === 'employee');
    expect(emp).toBeTruthy();

    // QR erzeugen
    const qrRes = await request.get(`/api/users/${emp.id}/request-qr`, { headers: admin.headers });
    expect(qrRes.ok()).toBeTruthy();
    const qr = await qrRes.json();
    expect(qr.token).toBeTruthy();
    expect(qr.qrDataUrl).toContain('data:image');
    expect(qr.url).toContain(`/request/${qr.token}`);

    // Öffentliches Formular-Info (ohne Auth)
    const infoRes = await request.get(`/api/request-form/${qr.token}`);
    expect(infoRes.ok()).toBeTruthy();
    const info = await infoRes.json();
    expect(info.firstName).toBe(emp.firstName);
    expect(Array.isArray(info.leaveTypes)).toBeTruthy();

    // Antrag ohne Login einreichen
    const r = futureRange(300, 6);
    const submitRes = await request.post(`/api/request-form/${qr.token}`, { data: { type: 'vacation', startDate: r.startDate, endDate: r.endDate, reason: 'QR-Test' } });
    expect(submitRes.status()).toBe(201);
    expect((await submitRes.json()).status).toBe('pending');

    // Token zurücksetzen → alter Token ungültig, neuer Token unterscheidet sich
    const resetRes = await request.post(`/api/users/${emp.id}/request-token/reset`, { headers: admin.headers });
    expect(resetRes.ok()).toBeTruthy();
    const newToken = (await resetRes.json()).token;
    expect(newToken).not.toBe(qr.token);
    expect((await request.get(`/api/request-form/${qr.token}`)).status()).toBe(404);
    expect((await request.get(`/api/request-form/${newToken}`)).ok()).toBeTruthy();
  });

  test('QR nutzt die im Admin-Panel konfigurierte öffentliche URL', async ({ request }) => {
    const admin = await login(request, 'admin');
    await request.put('/api/settings', { headers: admin.headers, data: { publicUrl: 'https://qr.example.com' } });
    try {
      const users = (await (await request.get('/api/users', { headers: admin.headers })).json()).users || [];
      const emp = (Array.isArray(users) ? users : []).find((u) => u.role === 'employee');
      const qr = await (await request.get(`/api/users/${emp.id}/request-qr`, { headers: admin.headers })).json();
      expect(qr.url.startsWith('https://qr.example.com/request/')).toBeTruthy();
    } finally {
      await request.put('/api/settings', { headers: admin.headers, data: { publicUrl: '' } });
    }
  });

  test('QR-Endpunkt nur für Admin/HR; ungültiger Token 404', async ({ request }) => {
    const emp = await login(request, 'employee');
    const usersRes = await request.get('/api/users', { headers: emp.headers }).catch(() => null);
    // Mitarbeiter darf QR-Endpoint nicht nutzen
    const forbidden = await request.get('/api/users/1/request-qr', { headers: emp.headers });
    expect(forbidden.status()).toBe(403);
    expect((await request.get('/api/request-form/deadbeefdeadbeef00')).status()).toBe(404);
  });
});
