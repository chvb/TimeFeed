// @ts-check
// Stempel-Journal (v1.1.0): Terminal-Stempel per API (Terminal mit festem
// Standort) → „Zeiten verwalten" zeigt „Terminal · <Name>" und einen
// Google-Maps-Link mit den Terminal-Koordinaten.
const { test, expect } = require('@playwright/test');
const { login, uiLogin, ymd, fmtDayCell } = require('./helpers');

const TERMINAL_NAME = 'E2E Kiosk Halle 1';
const J_USER = { email: 'e2e-journal-jonas@timefeed.de', password: 'E2eJournal_123!' };
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test.describe('Journal-Details', () => {
  test('Terminal-Stempel zeigt Terminal-Namen und Karten-Link', async ({ page, request }) => {
    const admin = await login(request, 'admin');

    // Eigener Mitarbeiter für diese Spec.
    const created = await request.post('/api/users', {
      headers: admin.headers,
      data: {
        email: J_USER.email, password: J_USER.password,
        firstName: 'Jonas', lastName: 'Journal', role: 'mitarbeiter',
        companyId: admin.user.companyId,
      },
    });
    expect([201, 400]).toContain(created.status());
    const users = (await (await request.get('/api/users', { headers: admin.headers })).json()).users;
    const jonas = users.find((u) => u.email === J_USER.email);
    expect(jonas.stampCode).toMatch(/^\d{8}$/);

    // Terminal MIT Koordinaten — Terminal-Stempel übernehmen den Gerätestandort.
    const termRes = await request.post('/api/terminals', {
      headers: admin.headers,
      data: {
        name: TERMINAL_NAME,
        locationLabel: 'Halle 1',
        companyId: admin.user.companyId,
        lat: 52.52,
        lng: 13.405,
        config: { methods: ['code'], requirePin: false },
      },
    });
    expect(termRes.status()).toBe(201);
    const { token } = await termRes.json();

    // Kommen/Gehen per Terminal-API stempeln.
    for (const type of ['in', 'out']) {
      const stamp = await request.post('/api/terminal/stamp', {
        headers: { 'X-Terminal-Token': token },
        data: { stampCode: jonas.stampCode, type },
      });
      expect(stamp.status()).toBe(201);
    }

    // „Zeiten verwalten" → Mitarbeiter öffnen → Tag aufklappen.
    await uiLogin(page, 'admin');
    await page.goto('/manage-times');
    await expect(page.getByRole('heading', { name: 'Zeiten verwalten' })).toBeVisible();
    await page.getByRole('row', { name: /Jonas Journal/ }).click();
    await expect(page.getByRole('button', { name: 'Nachbuchen' })).toBeVisible();

    const dayRow = page.getByRole('row', { name: new RegExp(esc(fmtDayCell(ymd()))) }).first();
    await expect(dayRow).toBeVisible();
    await dayRow.click();

    // Journal: Quelle „Terminal · <Name>" + Karten-Link auf google.com/maps?q=…
    await expect(page.getByText('Stempelungen', { exact: true }).first()).toBeVisible();
    await expect(page.getByText(`Terminal · ${TERMINAL_NAME}`).first()).toBeVisible();

    const mapLink = page.getByTitle('Standort auf Karte öffnen').first();
    await expect(mapLink).toBeVisible();
    await expect(mapLink).toHaveAttribute('href', /google\.com\/maps\?q=52\.52/);
    await expect(mapLink).toHaveAttribute('target', '_blank');
  });
});
