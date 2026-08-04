import { defineConfig } from '@playwright/test'
import {
  CANONICAL_QUOTE_COMMITMENT_BASE_URL,
  assertQuoteCommitmentHarnessSafety,
} from './tests/e2e/quote-composition-commitment-harness/safety.mjs'

assertQuoteCommitmentHarnessSafety(process.env, CANONICAL_QUOTE_COMMITMENT_BASE_URL)

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /quote-composition-commitment-proof\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  webServer: {
    command: 'node tests/e2e/quote-composition-commitment-harness/server.mjs',
    url: CANONICAL_QUOTE_COMMITMENT_BASE_URL,
    reuseExistingServer: false,
  },
  use: {
    baseURL: CANONICAL_QUOTE_COMMITMENT_BASE_URL,
    channel: process.env.PLAYWRIGHT_USE_SYSTEM_CHROME === '1' ? 'chrome' : undefined,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'quote-commitment-phone',
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'quote-commitment-desktop',
      use: {
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
  ],
})
