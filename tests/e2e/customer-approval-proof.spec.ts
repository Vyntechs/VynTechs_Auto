import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  assertNoBrowserFaults,
  checkpoint,
  watchBrowserFaults,
} from './golden-browser-receipts'

const TOKEN = 'A'.repeat(43)
const JOB_ONE = '00000000-0000-4000-8000-000000000011'
const JOB_TWO = '00000000-0000-4000-8000-000000000012'
const evidenceDirectory = resolve(process.cwd(), 'test-results/customer-approval')
const productionServer = process.env.PLAYWRIGHT_PRODUCTION_SERVER === '1'

const quote = {
  shop: { name: 'Approval Auto', phone: '555-0100' },
  customer: { name: 'Casey Customer' },
  vehicle: { year: 2020, make: 'Ford', model: 'F-150' },
  ticketNumber: 42,
  versionNumber: 1,
  expiresAt: '2026-08-09T12:00:00.000Z',
  jobs: [
    {
      id: JOB_ONE,
      title: 'Front brake repair',
      story: null,
      lines: [{ kind: 'labor', description: 'Replace front brake pads', quantity: '1', priceCents: 10_000 }],
      subtotalCents: 10_000,
      taxableSubtotalCents: 0,
    },
    {
      id: JOB_TWO,
      title: 'Brake fluid service',
      story: null,
      lines: [{ kind: 'fee', description: 'Brake fluid', quantity: '1', priceCents: 5_000 }],
      subtotalCents: 5_000,
      taxableSubtotalCents: 0,
    },
  ],
  totals: { subtotalCents: 15_000, taxCents: 0, totalCents: 15_000 },
  taxRateBps: 0,
}

async function mockApprovalApi(page: Page): Promise<void> {
  await page.route('**/api/public/quote-approval', async (route) => {
    const request = route.request()
    if (request.headers().authorization !== `Bearer ${TOKEN}`) {
      await route.fulfill({ status: 404, json: { error: 'unavailable' } })
      return
    }
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, json: { quote } })
      return
    }
    const body = request.postDataJSON() as {
      decisions: Array<{ jobId: string; decision: 'approved' | 'declined' }>
    }
    await route.fulfill({
      status: 201,
      json: {
        changed: true,
        receipt: {
          versionNumber: 1,
          decisions: body.decisions,
          approvedTotalCents: body.decisions.some((item) => (
            item.jobId === JOB_ONE && item.decision === 'approved'
          )) ? 10_000 : 0,
        },
      },
    })
  })
}

test('customer approval feels settled and completes without phone overflow or browser faults', async ({ page }, testInfo) => {
  test.skip(productionServer, 'mounted visual proof runs against the development server')
  await page.setViewportSize({ width: 390, height: 844 })
  const faults = watchBrowserFaults(page, testInfo.project.name)
  await mockApprovalApi(page)
  await page.goto(`/approve#${TOKEN}`)

  await expect(page).toHaveURL(/\/approve$/)
  await expect(page.getByRole('heading', { name: 'Review your repair order' })).toBeVisible()
  await expect(page.getByText('2020 Ford F-150')).toBeVisible()
  await expect.poll(() => page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }))).toEqual({ viewport: 390, content: 390 })
  await checkpoint(page, testInfo, 'customer-approval-phone-review')

  await page.getByRole('button', { name: 'Approve Front brake repair' }).click()
  await expect(page.getByText('$100.00 approved')).toBeVisible()
  await page.getByRole('button', { name: 'Decline Brake fluid service' }).click()
  await page.getByRole('button', { name: 'Send decisions' }).click()

  await expect(page.getByRole('heading', { name: 'Your decisions are recorded' })).toBeVisible()
  await expect(page.getByText('The shop now has this response. Call 555-0100 if anything changes.')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Your decisions are recorded' })).toHaveCSS('opacity', '1')
  await checkpoint(page, testInfo, 'customer-approval-phone-receipt')
  await mkdir(evidenceDirectory, { recursive: true })
  await page.screenshot({ path: resolve(evidenceDirectory, 'phone-receipt.png'), fullPage: true })
  assertNoBrowserFaults([faults])
})

test('production customer page refuses browser and intermediary storage', async ({ request }) => {
  test.skip(!productionServer, 'requires a production Next.js server')

  const response = await request.get('/approve')
  expect(response.status()).toBe(200)
  expect(response.headers()['cache-control']).toContain('no-store')
  expect(response.headers()['referrer-policy']).toBe('no-referrer')
  expect(response.headers()['x-robots-tag']).toBe('noindex, nofollow')
})

test('browser history cannot restore the bearer or private quote', async ({ page }, testInfo) => {
  test.skip(productionServer, 'mounted visual proof runs against the development server')
  await page.setViewportSize({ width: 390, height: 844 })
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-history`)
  await mockApprovalApi(page)
  await page.goto(`/approve#${TOKEN}`)
  await expect(page.getByText('Casey Customer')).toBeVisible()

  await page.goto('about:blank')
  await page.goBack()

  await expect(page).toHaveURL(/\/approve$/)
  await expect(page.getByRole('heading', { name: 'This link is no longer available' })).toBeVisible()
  await expect(page.getByText('Casey Customer')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Approve Front brake repair' })).toHaveCount(0)
  assertNoBrowserFaults([faults])
})

test('customer approval keeps deliberate geometry and exact truth on desktop', async ({ page }, testInfo) => {
  test.skip(productionServer, 'mounted visual proof runs against the development server')
  await page.setViewportSize({ width: 1440, height: 1000 })
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-desktop`)
  await mockApprovalApi(page)
  await page.goto(`/approve#${TOKEN}`)

  const instrument = page.getByRole('region', { name: 'Review your repair order' })
  await expect(page.getByRole('heading', { name: 'Review your repair order' })).toBeVisible()
  await expect(instrument).toHaveCSS('border-radius', '18px')
  await expect(page.getByRole('button', { name: 'Approve Front brake repair' })).toHaveCSS('min-height', '48px')
  await mkdir(evidenceDirectory, { recursive: true })
  await page.screenshot({ path: resolve(evidenceDirectory, 'desktop-review.png'), fullPage: true })
  assertNoBrowserFaults([faults])
})
