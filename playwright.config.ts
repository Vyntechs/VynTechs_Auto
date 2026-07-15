import { defineConfig, devices } from '@playwright/test'
import { STORAGE_STATE_PATH } from './tests/e2e/global-setup'

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'anonymous',
      use: {
        ...devices['Desktop Chrome'],
        ...(process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1'
          ? { channel: 'chrome' as const }
          : {}),
      },
      testMatch: /landing\.spec\.ts/,
    },
    {
      name: 'curator',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE_PATH,
      },
      testMatch: /curator(-flows)?\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
