// @ts-check
// Terminal-NFC über den FeedAuth-Hub: ein am Chip gelesener Hub-Token wird vom Terminal
// als hubToken übergeben und server-zu-server beim Hub (auth.feedapps.de) aufgelöst —
// NFC-Chips werden dadurch NUR zentral im Hub gepflegt. Getestet wird die Verdrahtung:
// ein hubToken wird als Kennung erkannt (nicht IDENTIFIER_REQUIRED) und über den Hub
// aufgelöst; ein unbekannter/ungültiger Token führt zu einer zentralen Absage.
const { test, expect } = require('@playwright/test');
const { login } = require('./helpers');

async function createTerminal(request, admin) {
  const res = await request.post('/api/terminals', {
    headers: admin.headers,
    data: {
      name: `E2E Hub-Kiosk ${Date.now()}`,
      locationLabel: 'Hub-NFC',
      companyId: admin.user.companyId,
      config: { methods: ['nfc', 'code'], requirePin: false },
    },
  });
  expect(res.status()).toBe(201);
  return (await res.json()).token;
}

test.describe('Terminal-NFC via Hub', () => {
  test('hubToken wird erkannt und zentral aufgelöst (unbekannt → keine Kennung/kein Fall-through)', async ({ request }) => {
    const admin = await login(request, 'admin');
    const token = await createTerminal(request, admin);

    const res = await request.post('/api/terminal/identify', {
      headers: { 'X-Terminal-Token': token },
      data: { hubToken: 'e2e-unknown-hub-token-xyz' },
    });
    // Der hubToken wurde als Kennung akzeptiert (NICHT 400 IDENTIFIER_REQUIRED) und über den
    // Hub geprüft: unbekannter Chip → 404 (UNKNOWN_CODE/NOT_LINKED) bzw. Hub offline → 503.
    expect([404, 503]).toContain(res.status());
    const body = await res.json();
    expect(['UNKNOWN_CODE', 'NOT_LINKED', 'HUB_UNAVAILABLE']).toContain(body.code);
  });

  test('Ohne jede Kennung → 400 IDENTIFIER_REQUIRED', async ({ request }) => {
    const admin = await login(request, 'admin');
    const token = await createTerminal(request, admin);

    const res = await request.post('/api/terminal/identify', {
      headers: { 'X-Terminal-Token': token },
      data: {},
    });
    expect(res.status()).toBe(400);
    expect((await res.json()).code).toBe('IDENTIFIER_REQUIRED');
  });
});
