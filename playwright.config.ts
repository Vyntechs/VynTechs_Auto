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
      use: { ...devices['Desktop Chrome'] },
      testMatch: /landing\.spec\.ts/,
    },
    {
      name: 'curator',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE_PATH,
      },
      testMatch: /curator\.spec\.ts/,
    },
    {
      name: 'topology',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE_PATH,
      },
      testMatch: /topology\.spec\.ts/,
    },
    {
      // Rehearsal-DB specs: requires VYNTECHS_E2E_REHEARSAL_DB=true and a dev
      // server backed by vyntechs_rehearsal with seed batches 1-7 applied.
      // The spec guards itself with test.describe.skip when the env var is unset,
      // so this project is harmless in CI (all tests skip cleanly).
      name: 'rehearsal-db',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /6\.0-psd-cranks-no-start-cache-hit\.spec\.ts/,
    },
  ],
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
