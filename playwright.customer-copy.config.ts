import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /customer-copy-proof\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  webServer: {
    command: 'node tests/e2e/customer-copy-harness/server.mjs',
    url: 'http://127.0.0.1:4178',
    reuseExistingServer: false,
  },
  use: {
    baseURL: 'http://127.0.0.1:4178',
    channel: 'chrome',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'customer-copy-phone',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'customer-copy-desktop',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
})
