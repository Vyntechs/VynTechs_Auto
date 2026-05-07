import { defineConfig, devices } from '@playwright/test'
import { STORAGE_STATE_PATH } from './tests/e2e/global-setup'

// PREVIEW_URL=https://<deploy>.vercel.app pnpm test:e2e
// runs the suite against a remote preview deploy instead of local dev.
// When set, the config skips spinning up `pnpm dev`.
const previewUrl = process.env.PREVIEW_URL?.replace(/\/$/, '')
const baseURL = previewUrl || 'http://localhost:3000'

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'anonymous',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /(landing|auth)\.spec\.ts/,
    },
    {
      name: 'curator',
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE_PATH,
      },
      testMatch: /(curator|sessions)\.spec\.ts/,
    },
  ],
  webServer: previewUrl
    ? undefined
    : {
        command: 'pnpm dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
})
