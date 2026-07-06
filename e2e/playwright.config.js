// @ts-check
const { defineConfig } = require('@playwright/test');
const { BASE_URL } = require('./lib/env');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  expect: { timeout: 10000 },
  retries: 0,
  workers: 1, // sequenziell — Tests teilen sich State (DB, Stempel-Zustände)
  // Eigener Server (Port 3040, Wegwerf-DB) wird in global-setup gestartet
  // und in global-teardown wieder beendet/gelöscht.
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  use: {
    baseURL: BASE_URL,
    locale: 'de-DE',
    trace: 'on-first-retry',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
