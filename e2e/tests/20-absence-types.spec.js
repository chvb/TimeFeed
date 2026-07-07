// @ts-check
// Abwesenheitsarten-Katalog (Yellowfox-Parität, Paket 1):
//  - Katalog-CRUD in den Einstellungen (Builtin gekennzeichnet, Neu/Bearbeiten/Löschen)
//  - manuelle Tages-Abwesenheit in „Zeiten verwalten" (Chip erscheint)
//  - Export-Mapping (Lohnartnummern) speichern + Vorschau zeigt die
//    Lohnarten-Aufschlüsselung und NO_LOHNART-Hinweise; LuG-Datei im
//    kalendertäglichen Yellowfox-Referenzformat.
const { test, expect } = require('@playwright/test');
const { USERS, login, uiLogin, expectToast, ymd, prevMonth, fmtDayCell, pastSlotInCurrentMonth } = require('./helpers');

const slot = pastSlotInCurrentMonth();

/** Ein Mittwoch im Vormonat (sicher ein Arbeitstag mit Sollzeit). */
function prevMonthWednesday(offsetDays = 0) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 8);
  while (d.getDay() !== 3) d.setDate(d.getDate() + 1);
  d.setDate(d.getDate() + offsetDays);
  return ymd(d);
}

test.describe('Abwesenheitsarten', () => {
  test('Katalog-CRUD in den Einstellungen (Builtin geschützt)', async ({ page, request }) => {
    await uiLogin(page, 'admin');
    await page.goto('/settings?tab=time');
    await expect(page.getByRole('heading', { name: 'Abwesenheitsarten' })).toBeVisible();

    // Eingebaute Arten sichtbar und als „Eingebaut" gekennzeichnet.
    const vacationRow = page.getByRole('row', { name: /Urlaub/ }).first();
    await expect(vacationRow).toBeVisible();
    await expect(vacationRow.getByText('Eingebaut')).toBeVisible();
    await expect(page.getByRole('row', { name: /Schlechtwetter/ })).toBeVisible();

    // --- Neu anlegen ---
    await page.getByRole('button', { name: 'Neue Abwesenheitsart' }).click();
    await page.locator('#abs-type-label').fill('Homeoffice');
    await page.locator('#abs-type-key').fill('homeoffice');
    const typeForm = page.locator('form').filter({ has: page.locator('#abs-type-label') });
    await typeForm.getByRole('button', { name: 'Speichern' }).click();
    await expectToast(page, 'Abwesenheitsart gespeichert.');
    const hoRow = page.getByRole('row', { name: /homeoffice/ });
    await expect(hoRow).toBeVisible();

    // --- Bearbeiten (Label ändern) ---
    await hoRow.getByRole('button', { name: 'Bearbeiten' }).click();
    await page.locator('#abs-type-label').fill('Mobiles Arbeiten');
    await typeForm.getByRole('button', { name: 'Speichern' }).click();
    await expectToast(page, 'Abwesenheitsart gespeichert.');
    await expect(page.getByRole('row', { name: /Mobiles Arbeiten/ })).toBeVisible();

    // --- Aktiv-Toggle ---
    const editedRow = page.getByRole('row', { name: /Mobiles Arbeiten/ });
    await editedRow.getByRole('checkbox').uncheck();
    await expect(editedRow.getByRole('checkbox')).not.toBeChecked();
    await editedRow.getByRole('checkbox').check();

    // --- Löschen (mit Bestätigung) ---
    await editedRow.getByRole('button', { name: 'Löschen' }).click();
    await page.getByRole('button', { name: 'OK', exact: true }).click();
    await expectToast(page, 'Abwesenheitsart gelöscht.');
    await expect(page.getByRole('row', { name: /Mobiles Arbeiten/ })).toHaveCount(0);

    // --- API: Builtin ist nicht löschbar, Key nicht änderbar; Schreiben nur admin ---
    const a = await login(request, 'admin');
    const list = await request.get('/api/absence-types', { headers: a.headers });
    expect(list.ok()).toBeTruthy();
    const types = (await list.json()).absenceTypes;
    const vacation = types.find((t) => t.key === 'vacation');
    expect(vacation.isBuiltin).toBeTruthy();
    expect(vacation.datevKennzeichen).toBe('U');
    const del = await request.delete(`/api/absence-types/${vacation.id}`, { headers: a.headers });
    expect(del.status()).toBe(400);
    const keyChange = await request.put(`/api/absence-types/${vacation.id}`, {
      headers: a.headers, data: { key: 'anders' },
    });
    expect(keyChange.status()).toBe(400);

    const emp = await login(request, 'mitarbeiter');
    const forbidden = await request.post('/api/absence-types', {
      headers: emp.headers, data: { key: 'hack', label: 'Hack' },
    });
    expect(forbidden.status()).toBe(403);
    // Lesen dürfen alle Rollen (Badges in „Meine Zeiten").
    const empList = await request.get('/api/absence-types', { headers: emp.headers });
    expect(empList.ok()).toBeTruthy();
  });

  test('Manuelle Tages-Abwesenheit in Zeiten verwalten (Chip erscheint)', async ({ page, request }) => {
    await uiLogin(page, 'verwaltung');
    await page.goto('/manage-times');
    await expect(page.getByRole('heading', { name: 'Zeiten verwalten' })).toBeVisible();

    // Detail des Verwalters selbst öffnen (Tag aus Spec 05 vorhanden).
    const row = page.getByRole('row', { name: new RegExp(USERS.verwaltung.name) });
    await row.click();
    await expect(page.getByRole('button', { name: 'Nachbuchen' })).toBeVisible();

    // Tag aufklappen → „Abwesenheit setzen"-Select erscheint.
    const absenceSelect = page.locator(`#absence-${slot.date}`);
    const dateRow = page.getByRole('row', { name: fmtDayCell(slot.date) }).first();
    await dateRow.click();
    await expect(absenceSelect).toBeVisible();

    // „Urlaub" setzen → Toast + Chip in der Tageszeile.
    await absenceSelect.selectOption({ label: 'Urlaub' });
    await expectToast(page, 'Abwesenheit gespeichert.');
    await expect(page.locator('.status-badge').filter({ hasText: 'Urlaub' }).first()).toBeVisible();

    // API-Gegenprobe: WorkDay trägt absence + absenceSource='manual', Soll gutgeschrieben.
    const v = await login(request, 'verwaltung');
    const daysRes = await request.get(`/api/time/days?userId=${v.user.id}&month=${slot.date.slice(0, 7)}`, { headers: v.headers });
    const day = (await daysRes.json()).days.find((d) => d.date === slot.date);
    expect(day.absence).toBe('vacation');
    expect(day.absenceSource).toBe('manual');
    expect(day.flags).toContain('target_credited');

    // Entfernen (absenceKey null) räumt nur manuelle Quellen ab.
    const clear = await request.put(`/api/time/days/${v.user.id}/${slot.date}/absence`, {
      headers: v.headers, data: { absenceKey: null },
    });
    expect(clear.ok()).toBeTruthy();
    expect((await clear.json()).workDay.absence).toBeNull();

    // Mitarbeiter dürfen keine Abwesenheiten setzen (Rollen-Gate).
    const emp = await login(request, 'mitarbeiter');
    const deny = await request.put(`/api/time/days/${emp.user.id}/${slot.date}/absence`, {
      headers: emp.headers, data: { absenceKey: 'vacation' },
    });
    expect(deny.status()).toBe(403);
  });

  test('Export-Mapping speichern + Vorschau zeigt Lohnarten-Zeile und NO_LOHNART-Hinweis', async ({ page, request }) => {
    const month = prevMonth();
    const vacDate = prevMonthWednesday(0);
    const docDate = prevMonthWednesday(1); // Donnerstag danach

    // Abwesenheiten im Vormonat setzen (Lisa Weber, Monat ist seit Spec 07 wieder offen):
    // Urlaub (wird gemappt) + Arztbesuch (ohne Lohnart → NO_LOHNART-Hinweis).
    const b = await login(request, 'buchhaltung');
    const emp = await login(request, 'mitarbeiter');
    for (const [date, key] of [[vacDate, 'vacation'], [docDate, 'doctor']]) {
      const res = await request.put(`/api/time/days/${emp.user.id}/${date}/absence`, {
        headers: b.headers, data: { absenceKey: key },
      });
      expect(res.ok()).toBeTruthy();
    }

    // --- Exportprofil per UI: Mapping Urlaub=1600, Feiertage=900, DATEV-Nummern ---
    await uiLogin(page, 'buchhaltung');
    await page.goto('/exports');
    await page.getByRole('button', { name: /Exportprofil/ }).click();
    await expect(page.getByText('Lohnartnummern je Abwesenheitsart')).toBeVisible();
    // Berater-/Mandantennummer: Labels ohne htmlFor → über Platzhalter ansprechen.
    await page.getByPlaceholder('1234567').fill('501864');
    await page.getByPlaceholder('10001').fill('26011');
    await page.getByLabel('Lohnart für Urlaub').fill('1600');
    await page.getByLabel('Lohnart Feiertage').fill('900');
    await page.getByRole('button', { name: 'Profil speichern' }).click();
    await expectToast(page, 'Exportprofil gespeichert');

    // --- Vorschau: Lohnarten-Aufschlüsselung aufklappbar + Hinweis ---
    await page.getByRole('button', { name: 'Vorschau', exact: true }).click();
    const lisaRow = page.getByRole('row', { name: new RegExp(USERS.mitarbeiter.name) });
    await expect(lisaRow).toBeVisible();

    // NO_LOHNART-Hinweis für Arztbesuch (ohne Mapping).
    await expect(page.getByText(/Arztbesuch: keine Lohnartnummer hinterlegt/)).toBeVisible();

    await lisaRow.click();
    await expect(page.getByText('Lohnarten-Aufschlüsselung')).toBeVisible();
    const lohnartRows = page.getByTestId('lohnart-row');
    await expect(lohnartRows.filter({ hasText: 'Lohnart 1600' })).toHaveCount(1);
    await expect(lohnartRows.filter({ hasText: 'Lohnart 1600' })).toContainText('Urlaub');
    await expect(lohnartRows.filter({ hasText: 'Lohnart 200' }).first()).toContainText('Normalstunden');

    // --- Vorschau-API: rows[].lohnarten mit source 'vacation' und Stunden > 0 ---
    const prevRes = await request.get(`/api/exports/preview?month=${month}`, { headers: b.headers });
    expect(prevRes.ok()).toBeTruthy();
    const prevBody = await prevRes.json();
    const lisa = prevBody.rows.find((r) => r.name.includes('Weber'));
    const vacEntry = lisa.lohnarten.find((e) => e.source === 'vacation');
    expect(vacEntry.lohnart).toBe('1600');
    expect(vacEntry.hours).toBeGreaterThan(0);
    expect(prevBody.warnings.some((w) => w.type === 'NO_LOHNART' && w.absenceKey === 'doctor' && w.days >= 1)).toBeTruthy();

    // --- LuG-Datei: kalendertägliches Yellowfox-Referenzformat ---
    const run = await request.get(`/api/exports/run?month=${month}&format=lug&force=true`, { headers: b.headers });
    expect(run.ok()).toBeTruthy();
    const body = await run.text();
    const lines = body.split('\r\n').filter((l) => l !== '');
    expect(lines[0]).toBe(`501864;26011;${month.slice(5)}/${month.slice(0, 4)}`);
    for (const line of lines.slice(1)) {
      expect(line.split(';')).toHaveLength(11);          // 5 leere Schlussfelder
      expect(line).toMatch(/^[^;]*;\d{2};.;[^;]+;\d+,\d{2};1,00;;;;;$/); // TT;KZ;Lohnart;Stunden;1,00
    }
    // Urlaubszeile: Kennzeichen 'U', Lohnart 1600, Tag = TT des gesetzten Datums.
    const tt = vacDate.slice(8, 10);
    expect(lines.some((l) => l.includes(`;${tt};U;1600;`))).toBeTruthy();
    // Arztbesuch ohne Lohnart erzeugt KEINE Zeile.
    expect(lines.some((l) => l.includes(`;${docDate.slice(8, 10)};1;1600;`))).toBeFalsy();
    expect(body).not.toContain(';doctor;');

    // Aufräumen: Abwesenheiten im Vormonat wieder entfernen (Suite-Neutralität).
    for (const date of [vacDate, docDate]) {
      await request.put(`/api/time/days/${emp.user.id}/${date}/absence`, {
        headers: b.headers, data: { absenceKey: null },
      });
    }
  });
});
