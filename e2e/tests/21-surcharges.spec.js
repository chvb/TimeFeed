// @ts-check
// Zuschlagsprofile (Yellowfox-Parität Paket 2, z. B. Nachtarbeit):
// Profil per UI anlegen (Seite „Zeitmodelle"), Gruppe per UI zuordnen,
// Nachtschicht per API stempeln, Export-Vorschau zeigt die Zuschlags-Zeile
// (source 'surcharge:<label>') und der LuG-Export die Zusatzzeile.
const { test, expect } = require('@playwright/test');
const { login, uiLogin, expectToast, prevMonth, chooseOption } = require('./helpers');

const PROFILE_NAME = 'E2E Nachtzuschlag';
const GROUP_NAME = 'E2E Nachtschicht';
const NIGHT_USER = { email: 'nacht@timefeed.de', password: 'E2eNacht_Pass123!', name: 'Nora Nacht' };
const EMPLOYEE_NUMBER = 'ZN1026';

const month = prevMonth();

/** Gruppe + Nachtschicht-Mitarbeiterin per API sicherstellen (idempotent). */
async function ensureGroupAndUser(request) {
  const admin = await login(request, 'admin');

  let groups = (await (await request.get('/api/groups', { headers: admin.headers })).json()).groups;
  let group = groups.find((g) => g.name === GROUP_NAME);
  if (!group) {
    const res = await request.post('/api/groups', {
      headers: admin.headers,
      data: { name: GROUP_NAME, description: 'e2e Zuschläge' },
    });
    expect(res.status()).toBe(201);
    group = (await res.json()).group;
  }

  let users = (await (await request.get('/api/users', { headers: admin.headers })).json()).users;
  let nora = users.find((u) => u.email === NIGHT_USER.email);
  if (!nora) {
    const res = await request.post('/api/users', {
      headers: admin.headers,
      data: {
        email: NIGHT_USER.email,
        password: NIGHT_USER.password,
        firstName: 'Nora',
        lastName: 'Nacht',
        role: 'mitarbeiter',
        companyId: admin.user.companyId,
        groupId: group.id,
        employeeNumber: EMPLOYEE_NUMBER,
      },
    });
    expect(res.status()).toBe(201);
    nora = (await res.json()).user;
  }
  return { admin, group, nora };
}

async function getProfileId(request) {
  const admin = await login(request, 'admin');
  const res = await request.get('/api/surcharge-profiles', { headers: admin.headers });
  expect(res.ok()).toBeTruthy();
  const list = (await res.json()).surchargeProfiles || [];
  const profile = list.find((p) => p.name === PROFILE_NAME);
  expect(profile, `Zuschlagsprofil "${PROFILE_NAME}" muss existieren`).toBeTruthy();
  return profile.id;
}

test.describe('Zuschlagsprofile (Nachtarbeit)', () => {
  test('Admin legt ein Zuschlagsprofil per UI an (Seite Zeitmodelle)', async ({ page }) => {
    await uiLogin(page, 'admin');
    await page.goto('/time-models');
    await expect(page.getByRole('heading', { name: 'Zuschlagsprofile' })).toBeVisible();

    await page.getByRole('button', { name: 'Zuschlagsprofil hinzufügen' }).click();
    await expect(page.getByText('Neues Zuschlagsprofil')).toBeVisible();

    await page.getByPlaceholder('z. B. Nachtarbeit').fill(PROFILE_NAME);
    // Fenster-Zeile: 20:00–06:00 (über Mitternacht), Lohnart 1010, 25 %, Label.
    const timeInputs = page.locator('input[type="time"]');
    await timeInputs.nth(0).fill('20:00');
    await timeInputs.nth(1).fill('06:00');
    await page.getByPlaceholder('1010').fill('1010');
    await page.getByPlaceholder('25').fill('25');
    await page.getByPlaceholder('z. B. Nachtzuschlag').fill('Nachtarbeit');
    // exact:true — der Hinweistext des Fenster-Editors enthält die Phrase ebenfalls.
    await expect(page.getByText('über Mitternacht', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
    await expectToast(page, 'Zuschlagsprofil gespeichert');

    // Liste zeigt das Profil mit Fenster-Zusammenfassung (Zelle der Desktop-
    // Tabelle — getByText würde zusätzlich die versteckte Mobile-Card treffen).
    await expect(page.getByRole('cell', { name: PROFILE_NAME })).toBeVisible();
    await expect(page.getByRole('cell', { name: /Nachtarbeit: 20:00–06:00 · 1010 · 25 %/ })).toBeVisible();
  });

  test('Gruppe bekommt das Zuschlagsprofil per UI zugeordnet', async ({ page, request }) => {
    const { group } = await ensureGroupAndUser(request);
    const profileId = await getProfileId(request);

    await uiLogin(page, 'admin');
    await page.goto('/groups');
    await expect(page.getByRole('heading', { name: 'Gruppen & Abteilungen' })).toBeVisible();

    const row = page.getByRole('row', { name: new RegExp(GROUP_NAME) });
    await expect(row).toBeVisible();
    await row.locator('button.text-primary-600').click();

    await expect(page.getByText('Gruppe bearbeiten')).toBeVisible();
    // Custom-Select: Trigger-Button zeigt den aktuellen Wert ("Kein Zuschlagsprofil").
    await chooseOption(page.getByRole('button').filter({ hasText: 'Kein Zuschlagsprofil' }), PROFILE_NAME);
    await page.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(page.getByText('Gruppe bearbeiten')).toBeHidden();

    // Verifikation über die API: Gruppe trägt das Zuschlagsprofil.
    const admin = await login(request, 'admin');
    const groups = (await (await request.get('/api/groups', { headers: admin.headers })).json()).groups;
    const g = groups.find((x) => x.id === group.id);
    expect(g.surchargeProfileId).toBe(profileId);
  });

  test('Nachtschicht per API → Vorschau + LuG zeigen die Zuschlags-Zeile', async ({ page, request }) => {
    const { admin, nora } = await ensureGroupAndUser(request);

    // Falls ein früherer Test den Monat geschlossen hinterlassen hat: best effort öffnen.
    await request.post('/api/time/reopen-month', { headers: admin.headers, data: { month } });

    // Nachtschicht 22:00–06:00 (15. → 16. des Vormonats) — über Mitternacht.
    const manual = (day, time, type) => request.post('/api/time/manual', {
      headers: admin.headers,
      data: {
        userId: nora.id,
        type,
        timestamp: new Date(`${month}-${day}T${time}:00`).toISOString(),
        note: 'e2e Nachtschicht',
      },
    });
    expect((await manual('15', '22:00', 'in')).status()).toBe(201);
    expect((await manual('16', '06:00', 'out')).status()).toBe(201);

    // --- API-Vorschau: Zuschlags-Eintrag mit source 'surcharge:Nachtarbeit' ---
    // (Fenster 20:00–06:00 ∩ Schicht 22:00–06:00 = 8,00 h; Pausenmodus 'auto'
    // → Brutto-Schnitt, die Ist-Zeit selbst ist 7,5 h wegen Auto-Pause.)
    const buch = await login(request, 'buchhaltung');
    const previewRes = await request.get(`/api/exports/preview?month=${month}`, { headers: buch.headers });
    expect(previewRes.ok()).toBeTruthy();
    const preview = await previewRes.json();
    const noraRow = preview.rows.find((r) => r.name === NIGHT_USER.name);
    expect(noraRow).toBeTruthy();
    const surcharge = noraRow.lohnarten.find((l) => l.source === 'surcharge:Nachtarbeit');
    expect(surcharge).toBeTruthy();
    expect(surcharge.lohnart).toBe('1010');
    expect(surcharge.hours).toBe(8);

    // --- LuG-Export: Zusatzzeile im Yellowfox-Referenzformat ---
    const run = await request.get(`/api/exports/run?month=${month}&format=lug&force=true`, { headers: buch.headers });
    expect(run.ok()).toBeTruthy();
    const lug = (await run.body()).toString('latin1');
    expect(lug).toContain(`${EMPLOYEE_NUMBER};15;1;1010;8,00;1,00;;;;;`);

    // --- UI-Vorschau: aufgeklappte Zeile zeigt „Zuschlag Nachtarbeit" ---
    await uiLogin(page, 'buchhaltung');
    await page.goto('/exports');
    await expect(page.getByRole('heading', { name: 'Lohn-Export' })).toBeVisible();
    await page.getByRole('button', { name: 'Vorschau', exact: true }).click();

    const uiRow = page.getByRole('row', { name: new RegExp(NIGHT_USER.name) });
    await expect(uiRow).toBeVisible();
    await uiRow.click();
    await expect(page.getByText('Zuschlag Nachtarbeit')).toBeVisible();
    await expect(page.getByText('Lohnart 1010')).toBeVisible();
  });
});
