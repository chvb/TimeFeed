// @ts-check
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

// Läuft seriell – togglet die globale Einstellung proRataEnabled und rechnet Salden neu.
test.describe.configure({ mode: 'serial' });

test.describe('Anteiliger Anspruch (Pro-rata) + Teilzeit', () => {
  test('Eintritt zur Jahresmitte + 50% Teilzeit halbiert den Anspruch zweifach', async ({ request }) => {
    const admin = await login(request, 'admin');
    const year = new Date().getFullYear();
    let uid;
    try {
      await request.put('/api/settings', { headers: admin.headers, data: { proRataEnabled: true } });

      const email = `prorata-${Date.now()}@test.local`;
      const cu = await request.post('/api/users', {
        headers: admin.headers,
        data: { email, password: 'Test1234!', firstName: 'Pro', lastName: 'Rata', role: 'employee', vacationDays: 25 },
      });
      expect(cu.status()).toBe(201);
      uid = (await cu.json()).user.id;

      // Eintritt 1. Juli (6/12), Teilzeit 50 %, Basisanspruch 24 → 24*0.5*0.5 = 6
      await request.put(`/api/users/${uid}`, {
        headers: admin.headers,
        data: { entryDate: `${year}-07-01`, employmentFactor: 0.5, vacationDaysOverride: 24 },
      });

      await request.post('/api/cleanup/recompute-balances', { headers: admin.headers });

      const g = await request.get(`/api/users/${uid}`, { headers: admin.headers });
      const j = await g.json();
      const vd = j.vacationDays ?? j.user?.vacationDays;
      expect(vd).toBeCloseTo(6, 1);
    } finally {
      if (uid) await request.delete(`/api/users/${uid}`, { headers: admin.headers });
      await request.put('/api/settings', { headers: admin.headers, data: { proRataEnabled: false } });
      await request.post('/api/cleanup/recompute-balances', { headers: admin.headers });
    }
  });
});
