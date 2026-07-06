// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  retries: 0,
  workers: 1, // sequenziell — Tests teilen sich State (DB, Login)
  // Test-User vor der Suite anlegen, danach ALLE e2e-Daten restlos entfernen.
  globalSetup: require.resolve('./global-setup'),
  globalTeardown: require.resolve('./global-teardown'),
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:3030',
    extraHTTPHeaders: {
      Accept: 'application/json',
    },
    trace: 'on-first-retry',
  },
  reporter: [['list'], ['html', { open: 'never' }]],
});
