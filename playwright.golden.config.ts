import { defineConfig } from '@playwright/test'

const baseURL = process.env.GOLDEN_QA_BASE_URL ?? 'https://vyntechs.dev'
const retainEvidence = process.env.GOLDEN_QA_RETAIN_EVIDENCE === '1'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /golden-shop-day\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'test-results/golden-shop-day.json' }]],
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: retainEvidence ? 'only-on-failure' : 'off',
    trace: retainEvidence ? 'retain-on-failure' : 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'golden-phone',
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 1,
        hasTouch: true,
        isMobile: true,
      },
    },
    {
      name: 'golden-desktop',
      use: {
        browserName: 'chromium',
        channel: 'chrome',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      },
    },
  ],
})
