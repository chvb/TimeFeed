// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

test.describe('iCal-Kalender-Abo', () => {
  test('Abo-Link liefert gültigen ICS-Feed (ohne Auth), Token regenerierbar', async ({ request }) => {
    const emp = await login(request, 'employee');

    const r = await request.get('/api/users/me/ical', { headers: emp.headers });
    expect(r.ok()).toBeTruthy();
    const url1 = (await r.json()).url;
    expect(url1).toMatch(/\/api\/ical\/[a-f0-9]{16,}\.ics$/);

    // Feed ohne Auth-Header abrufbar (Token im Pfad)
    const feed = await request.get(url1);
    expect(feed.ok()).toBeTruthy();
    expect(feed.headers()['content-type']).toContain('text/calendar');
    const body = await feed.text();
    expect(body).toContain('BEGIN:VCALENDAR');
    expect(body).toContain('END:VCALENDAR');

    // Ungültiger Token → 404
    const bad = await request.get('/api/ical/0000000000000000deadbeef.ics');
    expect(bad.status()).toBe(404);

    // Regenerieren → neuer Link, alter ungültig
    const reg = await request.post('/api/users/me/ical/regenerate', { headers: emp.headers });
    const url2 = (await reg.json()).url;
    expect(url2).not.toBe(url1);
    expect((await request.get(url1)).status()).toBe(404);
    expect((await request.get(url2)).ok()).toBeTruthy();
  });
});
