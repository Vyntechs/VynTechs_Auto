import { defineConfig } from '@playwright/test'
import {
  CANONICAL_TECHNICIAN_HANDOFF_BASE_URL,
  assertTechnicianHandoffHarnessSafety,
} from './tests/e2e/technician-handoff-harness/safety.mjs'

assertTechnicianHandoffHarnessSafety(process.env, CANONICAL_TECHNICIAN_HANDOFF_BASE_URL)

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /technician-handoff-proof\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  webServer: {
    command: 'node tests/e2e/technician-handoff-harness/server.mjs',
    url: CANONICAL_TECHNICIAN_HANDOFF_BASE_URL,
    reuseExistingServer: false,
  },
  use: {
    baseURL: CANONICAL_TECHNICIAN_HANDOFF_BASE_URL,
    channel: process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1' ? 'chrome' : undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'technician-handoff-phone',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'technician-handoff-desktop',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
})
