import { defineConfig } from '@playwright/test'
import {
  CANONICAL_TICKET_CORRECTION_BASE_URL,
  assertTicketCorrectionHarnessSafety,
} from './tests/e2e/ticket-building-correction-harness/safety.mjs'

assertTicketCorrectionHarnessSafety(process.env, CANONICAL_TICKET_CORRECTION_BASE_URL)

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /ticket-building-correction-proof\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  webServer: {
    command: 'node tests/e2e/ticket-building-correction-harness/server.mjs',
    url: CANONICAL_TICKET_CORRECTION_BASE_URL,
    reuseExistingServer: false,
  },
  use: {
    baseURL: CANONICAL_TICKET_CORRECTION_BASE_URL,
    channel: process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1' ? 'chrome' : undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'ticket-correction-phone',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'ticket-correction-desktop',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
})
