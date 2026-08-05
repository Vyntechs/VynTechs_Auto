import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'
import type { Page, Route } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  parseQuoteBuilderProjection,
  summarizeQuoteMoney,
  type QuoteBuilderProjection,
} from '@/lib/shop-os/quote-builder-ui'
import {
  IMPLEMENTATION_JOB_ID,
  IMPLEMENTATION_SECOND_JOB_ID,
  IMPLEMENTATION_TICKET_ID,
} from './living-repair-order-harness/implementation-constants'
import {
  assertNoBrowserFaults,
  watchBrowserFaults,
} from './golden-browser-receipts'

const evidenceDirectory = resolve(process.cwd(), 'test-results/living-repair-order')

test.beforeAll(async () => {
  await mkdir(evidenceDirectory, { recursive: true })
})

test.describe('hermetic real-component implementation proof', () => {
  for (const role of ['tech', 'advisor', 'parts', 'owner'] as const) {
    test(`gives the assigned ${role} one job-bound Build ticket action`, async ({ page }, testInfo) => {
      const faults = watchBrowserFaults(page, `${testInfo.project.name}-${role}-entry`)
      const api = await installImplementationApi(page, role)

      await page.goto(implementationUrl(role))

      const job = page.getByRole('listitem', { name: 'Job correction target 01' })
      await expect(job.getByRole('button', { name: 'Build ticket' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Build ticket' })).toHaveCount(1)
      expect(api.unhandled).toEqual([])
      assertNoBrowserFaults([faults])
    })
  }

  test('builds and prepares the exact advisor ticket through real mounted components', async ({ page }, testInfo) => {
    const faults = watchBrowserFaults(page, `${testInfo.project.name}-real-advisor-causal-ticket`)
    const api = await installImplementationApi(page, 'advisor')
    const outsideFetches: string[] = []
    page.on('request', (request) => {
      if (request.resourceType() !== 'fetch') return
      const url = new URL(request.url())
      if (url.origin !== 'http://127.0.0.1:4183') outsideFetches.push(request.url())
    })

    await page.goto(implementationUrl('advisor'))
    const repairJob = page.getByRole('listitem', { name: 'Job correction target 01' })
    const opener = repairJob.getByRole('button', { name: 'Build ticket' })
    await expect(opener).toBeVisible()

    const more = page.getByRole('button', { name: 'More' })
    await expect(more).toHaveAttribute('aria-expanded', 'false')
    await expect(repairJob.getByRole('button', { name: 'Hand off' })).toHaveCount(0)
    await more.click()
    await expect(repairJob.getByRole('button', { name: 'Hand off' })).toBeVisible()

    await opener.click()
    const workspace = page.getByRole('region', { name: 'Quote for this repair order' })
    await expect(workspace).toBeVisible()
    await expect(workspace.getByRole('heading', { name: 'Build ticket' })).toBeVisible()
    const activeJob = workspace.locator('[data-active-job="true"]')
    await expect(activeJob).toBeFocused()
    await expect(workspace.getByText('No quote lines yet.')).toBeVisible()
    await expect(workspace.getByText('No price yet')).toBeVisible()
    await expect(workspace.getByText('$0.00')).toHaveCount(0)
    await expect(workspace.getByRole('button', { name: 'Prepare quote' })).toHaveCount(0)

    const addWork = workspace.getByText('Add work', { exact: true })
    await expect(addWork).toBeVisible()
    await expect(workspace.getByRole('region', { name: 'Add repair' })).toHaveCount(0)
    await addWork.click()
    await expect(workspace.getByRole('region', { name: 'Add repair' })).toBeVisible()
    await expect(workspace.getByRole('region', { name: 'Add diagnostic time' })).toBeVisible()
    await addWork.click()

    await workspace.getByRole('button', { name: 'Source part' }).click()
    const planned = page.getByRole('complementary', { name: 'Planned supplier connections, not live' })
    await expect(planned).toContainText("O'Reilly First Call")
    await expect(planned).toContainText('PartsTech')
    await expect(planned).toContainText('RepairLink')
    await expect(planned.getByRole('button')).toHaveCount(0)
    await expect(planned.getByRole('link')).toHaveCount(0)
    await page.getByRole('button', { name: 'Close part sourcing' }).click()

    if (testInfo.project.use.viewport?.width === 390) {
      await page.screenshot({ path: resolve(evidenceDirectory, 'implementation-phone-empty-390x844.png') })
    }

    await saveRealPart(page)
    await saveRealLabor(page)

    await expect(activeJob.getByText('Part · Qty 1')).toBeVisible()
    await expect(activeJob.getByText('Front brake pads', { exact: true })).toBeVisible()
    await expect(activeJob.getByText('Labor · 1.25 hr')).toBeVisible()
    await expect(activeJob.getByText('Install front brake pads', { exact: true })).toBeVisible()
    const totals = workspace.getByRole('complementary', { name: 'Quote totals' })
    await expect(totalRow(totals, 'Subtotal')).toContainText('$327.50')
    await expect(totalRow(totals, 'Taxable subtotal')).toContainText('$140.00')
    await expect(totalRow(totals, 'Tax')).toContainText('$11.55')
    await expect(totalRow(totals, 'Total')).toContainText('$339.05')
    await expect(totals.getByRole('button', { name: 'Prepare quote' })).toBeEnabled()
    await assertSurfaceHealth(page)

    const viewport = testInfo.project.use.viewport
    await page.screenshot({
      path: resolve(
        evidenceDirectory,
        viewport?.width === 390
          ? 'implementation-phone-lines-full-390x3024.png'
          : 'implementation-desktop-lines-1440x900.png',
      ),
      fullPage: viewport?.width === 390,
    })

    await totals.getByRole('button', { name: 'Prepare quote' }).click()
    await expect(workspace.getByRole('dialog', { name: 'Prepare this exact quote?' })).toContainText('1 job · 2 lines')
    await expect(workspace.getByRole('dialog', { name: 'Prepare this exact quote?' })).toContainText('Customer will see $339.05')
    await workspace.getByRole('button', { name: 'Prepare $339.05' }).click()

    await expect(workspace).toHaveCount(0)
    await expect(repairJob.getByText('Priced')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Record approval' })).toBeVisible()
    await expect(repairJob).toBeFocused()
    await expect(page.locator('body')).toHaveAttribute('data-route-changes', '0')
    await assertSurfaceHealth(page)

    await page.screenshot({
      path: resolve(
        evidenceDirectory,
        viewport?.width === 390
          ? 'implementation-phone-prepared-full-390x1500.png'
          : 'implementation-desktop-prepared-1440x900.png',
      ),
      fullPage: viewport?.width === 390,
    })

    expect(api.lineWrites).toBe(2)
    expect(api.prepareWrites).toBe(1)
    expect(api.lineBodies.map((body) => body.line)).toEqual([
      expect.objectContaining({ kind: 'part', description: 'Front brake pads', quantity: '1', priceCents: 14_000, taxable: true }),
      expect.objectContaining({ kind: 'labor', description: 'Install front brake pads', laborHours: '1.25', laborRateCents: 15_000, priceCents: 18_750, taxable: false }),
    ])
    expect(api.unhandled).toEqual([])
    expect(outsideFetches).toEqual([])
    assertNoBrowserFaults([faults])
  })

  test('keeps another technician job visible and read-only while the assigned technician earns the total', async ({ page }, testInfo) => {
    const faults = watchBrowserFaults(page, `${testInfo.project.name}-real-tech-boundary`)
    const api = await installImplementationApi(page, 'tech', { mixedJobs: true })

    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto(implementationUrl('tech', 'mixed'))
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
    const opener = page.getByRole('listitem', { name: 'Job correction target 01' })
      .getByRole('button', { name: 'Build ticket' })
    await opener.click()
    const workspace = page.getByRole('region', { name: 'Quote for this repair order' })
    await expect(workspace).toBeVisible()

    const otherJob = workspace.getByRole('heading', { name: 'Brake fluid service' }).locator('xpath=ancestor::li[1]')
    await expect(otherJob.getByText('No quote lines yet.')).toBeVisible()
    await expect(otherJob.getByRole('button', { name: /Add part|Add labor|Add fee|Source part/ })).toHaveCount(0)

    await saveRealPart(page)
    await saveRealLabor(page)
    const totals = workspace.getByRole('complementary', { name: 'Quote totals' })
    await expect(totalRow(totals, 'Total')).toContainText('$339.05')
    await expect(workspace.getByRole('button', { name: /Prepare/ })).toHaveCount(0)
    await assertSurfaceHealth(page)

    await page.getByRole('button', { name: 'Close quote' }).click()
    await expect(opener).toBeFocused()
    expect(api.lineWrites).toBe(2)
    expect(api.prepareWrites).toBe(0)
    expect(api.unhandled).toEqual([])
    assertNoBrowserFaults([faults])
  })

  test('requires an explicit real-component choice for equal-ranked jobs', async ({ page }, testInfo) => {
    const faults = watchBrowserFaults(page, `${testInfo.project.name}-real-tie`)
    const api = await installImplementationApi(page, 'advisor', { mixedJobs: true })

    await page.goto(implementationUrl('advisor', 'tie'))
    await expect(page.getByRole('button', { name: '2 jobs need attention' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Build ticket' })).toHaveCount(0)
    await page.getByRole('button', { name: '2 jobs need attention' }).click()
    await page.getByRole('button', { name: 'Front brake service' }).click()

    const selectedJob = page.getByRole('listitem', { name: 'Job correction target 01' })
    await expect(selectedJob.getByRole('button', { name: 'Build ticket' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Build ticket' })).toHaveCount(1)
    expect(api.unhandled).toEqual([])
    assertNoBrowserFaults([faults])
  })
})

test('builds one shared ticket causally from visible part and labor inputs', async ({ page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-causal-ticket`)
  const viewport = testInfo.project.use.viewport
  await page.goto('/?state=collapsed')

  const repairOrder = page.getByRole('region', { name: 'Repair order 001042' })
  const request = page.getByRole('heading', { name: 'Brake pedal pulses at highway speeds.' })
  const job = page.getByRole('heading', { name: 'Front brake service' })
  const ticketAction = page.getByRole('button', { name: 'Build ticket' })

  await expect(repairOrder).toBeVisible()
  await expect(request).toBeVisible()
  await expect(job).toBeVisible()
  await expect(ticketAction).toBeVisible()
  await expect(page.getByText(/Build price|Price by hand/)).toHaveCount(0)
  await expect(page.getByText('Add work', { exact: true })).not.toBeVisible()
  await expect(page.locator('[data-filled-action="true"]')).toHaveCount(1)

  if (viewport?.width === 390) {
    await page.screenshot({ path: resolve(evidenceDirectory, 'phone-ticket-entry-collapsed-390x844.png') })
  }

  await ticketAction.click()
  const builder = page.getByRole('region', { name: 'Ticket builder' })
  await expect(builder).toBeVisible()
  await expect(builder).toBeFocused()
  await expect(page.getByRole('button', { name: 'Close ticket builder' })).toBeVisible()
  await expect(page.locator('[data-builder-empty]')).toContainText('No parts, labor, or fees')
  await expect(page.locator('[data-quote-total]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Prepare quote' })).toHaveCount(0)
  await expect(page.locator('[data-filled-action="true"]')).toHaveCount(1)

  const expandedGeometry = await page.evaluate(() => {
    const chrome = document.querySelector<HTMLElement>('[data-proof-chrome]')?.getBoundingClientRect()
    const activeJob = document.querySelector<HTMLElement>('.jobTruth')?.getBoundingClientRect()
    const heading = document.querySelector<HTMLElement>('.jobHeading')?.getBoundingClientRect()
    return {
      chromeBottom: chrome?.bottom ?? -1,
      jobTop: activeJob?.top ?? -1,
      headingBottom: heading?.bottom ?? Number.POSITIVE_INFINITY,
      viewportHeight: window.innerHeight,
    }
  })
  expect(expandedGeometry.jobTop).toBeGreaterThanOrEqual(expandedGeometry.chromeBottom)
  expect(expandedGeometry.headingBottom).toBeLessThan(expandedGeometry.viewportHeight)

  await assertSurfaceHealth(page)

  await page.getByRole('button', { name: 'Add a part' }).click()
  const plannedConnectors = page.locator('[aria-label="Planned supplier connectors"]')
  await expect(plannedConnectors).toContainText('O’Reilly First Call')
  await expect(plannedConnectors).toContainText('PartsTech')
  await expect(plannedConnectors).toContainText('RepairLink')
  await expect(page.getByText('Planned connectors · not live', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'O’Reilly First Call' })).toHaveCount(0)
  await expect(page.locator('[data-quote-total]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Prepare quote' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Attach my part' }).click()
  await page.getByLabel('Supplier', { exact: true }).fill('O’Reilly First Call')
  await page.getByLabel('Part description').fill('Front brake pad set')
  await page.locator('[data-part-quantity]').fill('1')
  await page.locator('[data-part-unit-cost]').fill('100.00')
  await expect(page.locator('[data-part-customer-price]')).toHaveText('$140.00')
  await expect(page.locator('[data-quote-total]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Prepare quote' })).toHaveCount(0)
  const savePartAction = page.getByRole('button', { name: 'Save part' })
  await savePartAction.scrollIntoViewIfNeeded()
  await page.evaluate(() => window.scrollBy(0, -100))

  if (viewport?.width === 390) {
    await page.screenshot({ path: resolve(evidenceDirectory, 'phone-part-input-source-390x844.png') })
  }
  await assertSurfaceHealth(page)

  await savePartAction.click()
  await expect(page.locator('[data-line-kind="part"]')).toContainText('$140.00')
  await expect(page.locator('[data-quote-total]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Prepare quote' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Add labor' }).click()
  await page.getByLabel('Labor description').fill('Install front brake pads')
  await page.getByLabel('Hours').fill('1.25')
  await page.getByLabel('Rate per hour').fill('150.00')
  await expect(page.locator('[data-labor-line-price]')).toHaveText('$187.50')
  await expect(page.locator('[data-quote-total]')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Prepare quote' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Save labor' }).click()

  await expect(page.locator('[data-line-kind="part"]')).toContainText('1 × supplier cost + 40% markup')
  await expect(page.locator('[data-line-kind="part"]')).toContainText('$140.00')
  await expect(page.locator('[data-line-kind="labor"]')).toContainText('1.25 hr × $150.00/hr')
  await expect(page.locator('[data-line-kind="labor"]')).toContainText('$187.50')
  await expect(page.getByText('Subtotal').locator('..')).toContainText('$327.50')
  await expect(page.getByText('Tax · 8% on part').locator('..')).toContainText('$11.20')
  await expect(page.locator('[data-quote-total]')).toContainText('$338.70')
  await expect(page.getByRole('button', { name: 'Prepare quote' })).toBeVisible()
  await expect(page.locator('[data-filled-action="true"]')).toHaveCount(1)

  const arithmetic = await page.locator('[data-quote-math]').evaluate((element) => {
    const node = element as HTMLElement
    const part = Number(node.dataset.partCents)
    const labor = Number(node.dataset.laborCents)
    const fee = Number(node.dataset.feeCents)
    const tax = Number(node.dataset.taxCents)
    const total = Number(node.dataset.totalCents)
    return { part, labor, fee, tax, total, recomputed: part + labor + fee + tax }
  })
  expect(arithmetic).toEqual({
    part: 14_000,
    labor: 18_750,
    fee: 0,
    tax: 1_120,
    total: 33_870,
    recomputed: 33_870,
  })
  if (viewport?.width === 390) {
    await page.locator('.jobTruth').first().evaluate((element) => element.scrollIntoView({ block: 'start' }))
  } else {
    await page.locator('.work').evaluate((element) => element.scrollIntoView({ block: 'start' }))
  }

  if (viewport?.width === 390) {
    await page.screenshot({ path: resolve(evidenceDirectory, 'phone-lines-total-390x844.png') })
  } else {
    await page.screenshot({ path: resolve(evidenceDirectory, 'desktop-ticket-builder-lines-1440x900.png') })
  }
  await assertSurfaceHealth(page)

  await page.getByRole('button', { name: 'Prepare quote' }).click()
  await expect(page.getByText('This records Quote V1 from the 2 visible saved lines.')).toBeVisible()
  await page.getByRole('button', { name: 'Prepare $338.70' }).click()
  await expect(page.getByText('Quote V1 recorded')).toBeVisible()
  await expect(page.getByText('Saved ticket lines settled into this job.')).toBeVisible()
  await expect(page.getByText('Prepared total').locator('..')).toContainText('$338.70')
  await expect(page.getByRole('button', { name: 'Record approval' })).toBeVisible()
  await expect(page.locator('[data-filled-action="true"]')).toHaveCount(1)
  await expect(page.locator('body')).toHaveAttribute('data-route-changes', '0')
  await expect(page.locator('.jobTruth').first()).toBeFocused()
  await waitForAnimations(page, '.jobRow[data-settled="true"]')
  await expect(page.locator('.settleReceipt p')).toHaveCSS('opacity', '1')

  if (viewport?.width === 390) {
    await page.screenshot({ path: resolve(evidenceDirectory, 'phone-prepared-settled-390x844.png') })
  }

  await assertSurfaceHealth(page)
  assertNoBrowserFaults([faults])
})

test('returns focus to the ticket opener when the in-place builder closes', async ({ page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-focus-return`)
  await page.goto('/?state=collapsed')
  const opener = page.getByRole('button', { name: 'Build ticket' })
  await opener.click()
  await page.getByRole('button', { name: 'Close ticket builder' }).click()
  await expect(opener).toBeFocused()
  await expect(page.locator('[data-filled-action="true"]')).toHaveCount(1)
  assertNoBrowserFaults([faults])
})

test('keeps equal-ranked work honest before entering the same shared builder', async ({ page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-tie`)
  await page.goto('/?state=tie')
  await expect(page.getByRole('button', { name: '2 jobs need attention' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Front brake service' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Brake fluid service' })).toBeVisible()
  await expect(page.locator('[data-filled-action="true"]')).toHaveCount(1)
  await page.getByRole('button', { name: '2 jobs need attention' }).click()
  await page.getByRole('button', { name: 'Front brake service' }).click()
  await expect(page.getByRole('button', { name: 'Build ticket' })).toBeVisible()
  await expect(page.getByText('Add work', { exact: true })).not.toBeVisible()
  await expect(page.locator('[data-filled-action="true"]')).toHaveCount(1)
  await expect.poll(async () => page.evaluate(() => {
    const chrome = document.querySelector<HTMLElement>('[data-proof-chrome]')?.getBoundingClientRect()
    const heading = document.querySelector<HTMLElement>('.jobHeading')?.getBoundingClientRect()
    return (heading?.top ?? -1) >= (chrome?.bottom ?? Number.POSITIVE_INFINITY)
  })).toBe(true)
  await assertSurfaceHealth(page)
  assertNoBrowserFaults([faults])
})

test('renders the real Customer Copy as an ink-economical estimate projection', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.viewport?.width !== 1440, 'One desktop print receipt is sufficient.')
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-print`)
  await page.goto('/?state=print')

  const document = page.locator('[data-customer-copy-document]')
  await expect(document).toContainText('Estimate')
  await expect(document).toContainText('Ada Driver')
  await expect(document).toContainText('2020 Ford F-150')
  await expect(document).toContainText('Front brake service')
  await expect(document).toContainText('$338.70')
  await expect(document).not.toContainText('Assigned')
  await page.getByRole('button', { name: 'Print customer copy' }).click()
  await expect(page.locator('body')).toHaveAttribute('data-print-calls', '1')
  await expect(page.locator('body')).toHaveAttribute('data-print-ready-at-call', 'true')

  await page.emulateMedia({ media: 'print' })
  await expect(page.locator('[data-proof-chrome]')).toHaveCSS('display', 'none')
  await expect(document).toHaveCSS('display', 'block')
  await expect(document).toHaveCSS('box-shadow', 'none')
  await page.screenshot({ path: resolve(evidenceDirectory, 'customer-copy-print.png'), fullPage: true })
  assertNoBrowserFaults([faults])
})

test('preserves prepared meaning and removes settle motion when requested', async ({ page }, testInfo) => {
  test.skip(testInfo.project.use.viewport?.width !== 390, 'Phone proves the constrained motion path.')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/?state=collapsed')
  await buildReadyTicket(page)
  await page.getByRole('button', { name: 'Prepare quote' }).click()
  await page.getByRole('button', { name: 'Prepare $338.70' }).click()
  await expect(page.getByText('Saved ticket lines settled into this job.')).toBeVisible()
  await expect(page.locator('.settleReceipt span')).toHaveCSS('animation-name', 'none')
})

async function buildReadyTicket(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('button', { name: 'Build ticket' }).click()
  await page.getByRole('button', { name: 'Add a part' }).click()
  await page.getByRole('button', { name: 'Attach my part' }).click()
  await page.getByLabel('Supplier', { exact: true }).fill('O’Reilly First Call')
  await page.getByLabel('Part description').fill('Front brake pad set')
  await page.getByLabel('Quantity').fill('1')
  await page.getByLabel('Supplier unit cost').fill('100.00')
  await page.getByRole('button', { name: 'Save part' }).click()
  await page.getByRole('button', { name: 'Add labor' }).click()
  await page.getByLabel('Labor description').fill('Install front brake pads')
  await page.getByLabel('Hours').fill('1.25')
  await page.getByLabel('Rate per hour').fill('150.00')
  await page.getByRole('button', { name: 'Save labor' }).click()
}

type ProofRole = 'tech' | 'advisor' | 'parts' | 'owner'
type ProofLine = QuoteBuilderProjection['jobs'][number]['lines'][number]

const PART_LINE_ID = '00000000-0000-4000-8000-000000005001'
const LABOR_LINE_ID = '00000000-0000-4000-8000-000000005002'
const VERSION_ID = '00000000-0000-4000-8000-000000006001'
const DRAFT_FINGERPRINT = 'd'.repeat(64)

function implementationUrl(role: ProofRole, state?: 'mixed' | 'tie'): string {
  const query = new URLSearchParams({ mode: 'implementation', role })
  if (state) query.set('state', state)
  return `/?${query.toString()}`
}

function totalRow(scope: import('@playwright/test').Locator, label: string) {
  return scope.getByText(label, { exact: true }).locator('..')
}

async function saveRealPart(page: Page): Promise<void> {
  const workspace = page.getByRole('region', { name: 'Quote for this repair order' })
  await workspace.getByRole('button', { name: 'Add part' }).click()
  await workspace.getByLabel('Description').fill('Front brake pads')
  await workspace.getByLabel('Quantity').fill('1')
  await workspace.getByLabel('Line price').fill('140.00')
  await workspace.getByRole('button', { name: 'Save line' }).click()
  await expect(workspace.getByText('Front brake pads', { exact: true })).toBeVisible()
}

async function saveRealLabor(page: Page): Promise<void> {
  const workspace = page.getByRole('region', { name: 'Quote for this repair order' })
  await workspace.getByRole('button', { name: 'Add labor' }).click()
  await workspace.getByLabel('Description').fill('Install front brake pads')
  await workspace.getByLabel('Hours').fill('1.25')
  await workspace.getByLabel('Rate per hour').fill('150.00')
  await workspace.getByRole('button', { name: 'Save line' }).click()
  await expect(workspace.getByText('Install front brake pads', { exact: true })).toBeVisible()
}

async function installImplementationApi(
  page: Page,
  role: ProofRole,
  options: { mixedJobs?: boolean } = {},
) {
  let lines: ProofLine[] = []
  let prepared = false
  let lineWrites = 0
  let prepareWrites = 0
  const lineBodies: Array<{ clientKey?: string; line: Record<string, unknown> }> = []
  const requests: Array<{ method: string; path: string; status: number }> = []
  const unhandled: string[] = []

  async function fulfill(route: Route, path: string, status: number, body: unknown): Promise<void> {
    requests.push({ method: route.request().method(), path, status })
    await route.fulfill({
      status,
      contentType: 'application/json',
      body: JSON.stringify(body),
    })
  }

  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname

    if (method === 'GET' && path === '/api/whats-new/unseen-count') {
      await fulfill(route, path, 200, { count: 0 })
      return
    }
    if (method === 'GET' && path === `/api/tickets/${IMPLEMENTATION_TICKET_ID}/quote`) {
      await fulfill(route, path, 200, {
        builder: implementationBuilder(role, lines, prepared, options.mixedJobs === true),
      })
      return
    }
    if (method === 'GET' && path === '/api/shop/canned-jobs') {
      await fulfill(route, path, 200, { cannedJobs: [], taxRateBps: 825 })
      return
    }
    if (method === 'GET' && path === '/api/shop/vendor-accounts') {
      await fulfill(route, path, 200, { vendorAccounts: [] })
      return
    }
    if (method === 'POST' && path === `/api/tickets/${IMPLEMENTATION_TICKET_ID}/quote/jobs/${IMPLEMENTATION_JOB_ID}/lines`) {
      const body = request.postDataJSON() as { clientKey?: string; line?: Record<string, unknown> }
      if (!body.line || (body.line.kind !== 'part' && body.line.kind !== 'labor')) {
        await fulfill(route, path, 422, { error: 'invalid_input' })
        return
      }
      lineBodies.push({ clientKey: body.clientKey, line: body.line })
      const id = body.line.kind === 'part' ? PART_LINE_ID : LABOR_LINE_ID
      if (!lines.some((line) => line.id === id)) lines = [...lines, projectionLine(id, body.line)]
      lineWrites += 1
      await fulfill(route, path, 201, { changed: true, line: { id } })
      return
    }
    if (method === 'POST' && path === `/api/tickets/${IMPLEMENTATION_TICKET_ID}/quote/versions`) {
      const body = request.postDataJSON() as { expectedDraftFingerprint?: unknown }
      if (role === 'tech' || lines.length !== 2 || body.expectedDraftFingerprint !== DRAFT_FINGERPRINT) {
        await fulfill(route, path, 404, { error: 'not_found' })
        return
      }
      prepareWrites += 1
      prepared = true
      await fulfill(route, path, 201, {
        changed: true,
        version: { id: VERSION_ID, versionNumber: 1 },
      })
      return
    }

    unhandled.push(`${method} ${path}`)
    await fulfill(route, path, 500, { error: 'unhandled_proof_request' })
  })

  return {
    get lineWrites() { return lineWrites },
    get prepareWrites() { return prepareWrites },
    lineBodies,
    requests,
    unhandled,
  }
}

function implementationBuilder(
  role: ProofRole,
  lines: ProofLine[],
  prepared: boolean,
  mixedJobs: boolean,
): QuoteBuilderProjection {
  const totals = summarizeQuoteMoney(lines, 825)
  if (!totals.ok || totals.totalCents === null) throw new Error('Implementation proof totals are invalid')
  const versionable = lines.length > 0
  const activeVersion = prepared ? {
    id: VERSION_ID,
    versionNumber: 1,
    totalCents: totals.totalCents,
    contentFingerprint: DRAFT_FINGERPRINT,
    jobs: [{ jobId: IMPLEMENTATION_JOB_ID, subtotalCents: totals.subtotalCents }],
  } : null
  const builder = {
    ticket: { id: IMPLEMENTATION_TICKET_ID, status: 'open' as const, reconciled: true },
    configuration: {
      laborRateCents: 15_000,
      taxRateBps: 825,
      partsMarkupBps: 4_000,
      laborRateConfigured: true,
      taxRateConfigured: true,
    },
    jobs: [
      implementationJob({
        id: IMPLEMENTATION_JOB_ID,
        title: 'Front brake service',
        canEdit: role !== 'tech' || !prepared,
        approvalState: prepared ? 'quote_ready' as const : 'pending_quote' as const,
        lines,
      }),
      ...(mixedJobs ? [implementationJob({
        id: IMPLEMENTATION_SECOND_JOB_ID,
        title: 'Brake fluid service',
        canEdit: role !== 'tech',
        approvalState: 'pending_quote',
        lines: [],
      })] : []),
    ],
    capabilities: {
      canPrepareQuote: role !== 'tech',
      canRecordCustomerApproval: role === 'advisor' || role === 'owner',
      canCreateCustomerApprovalLink: false,
    },
    activeVersion,
    lastPreparedVersion: activeVersion ? {
      id: activeVersion.id,
      versionNumber: activeVersion.versionNumber,
      totalCents: activeVersion.totalCents,
      contentFingerprint: activeVersion.contentFingerprint,
      state: 'current' as const,
    } : null,
    draftCommitment: !prepared && versionable ? {
      algorithm: 'quote-draft-v1-sha256' as const,
      fingerprint: DRAFT_FINGERPRINT,
      totalCents: totals.totalCents,
      jobCount: 1,
      lineCount: lines.length,
    } : null,
  }
  const parsed = parseQuoteBuilderProjection(builder)
  if (!parsed) throw new Error('Implementation proof projection failed the production parser')
  return parsed
}

function implementationJob(input: {
  id: string
  title: string
  canEdit: boolean
  approvalState: 'pending_quote' | 'quote_ready'
  lines: ProofLine[]
}): QuoteBuilderProjection['jobs'][number] {
  return {
    id: input.id,
    title: input.title,
    kind: 'repair',
    workStatus: 'open',
    canEdit: input.canEdit,
    story: { content: null, source: null, reviewStatus: null, revision: 0 },
    storyMode: null,
    decisionEligible: input.approvalState === 'quote_ready',
    approval: { state: input.approvalState, quoteVersionId: null },
    lines: input.lines,
  }
}

function projectionLine(id: string, input: Record<string, unknown>): ProofLine {
  const common = {
    id,
    kind: input.kind as 'part' | 'labor',
    description: String(input.description),
    sort: Number(input.sort ?? 0),
    quantity: String(input.quantity ?? '1'),
    priceCents: Number(input.priceCents),
    taxable: input.taxable === true,
    source: 'manual' as const,
    mutable: true,
    lineFingerprint: (id === PART_LINE_ID ? '1' : '2').repeat(64),
  }
  return input.kind === 'labor' ? {
    ...common,
    kind: 'labor',
    quantity: '1',
    partNumber: null,
    brand: null,
    coreChargeCents: null,
    fitment: null,
    laborHours: String(input.laborHours),
    laborRateCents: Number(input.laborRateCents),
  } : {
    ...common,
    kind: 'part',
    partNumber: typeof input.partNumber === 'string' ? input.partNumber : null,
    brand: typeof input.brand === 'string' ? input.brand : null,
    coreChargeCents: typeof input.coreChargeCents === 'number' ? input.coreChargeCents : null,
    fitment: typeof input.fitment === 'string' ? input.fitment : null,
    laborHours: null,
    laborRateCents: null,
  }
}

async function assertSurfaceHealth(page: import('@playwright/test').Page): Promise<void> {
  const health = await page.evaluate(() => {
    const root = document.documentElement
    const selector = [
      'button:not(:disabled)',
      'a[href]',
      'summary',
      'input:not([type="radio"]):not([type="checkbox"]):not([type="hidden"]):not(:disabled)',
    ].join(', ')
    const enabledTargets = [...document.querySelectorAll<HTMLElement>(selector)]
      .filter((element) => {
        const style = getComputedStyle(element)
        const box = element.getBoundingClientRect()
        return style.display !== 'none' && style.visibility !== 'hidden' && box.width > 0 && box.height > 0
      })
      .map((element) => ({
        label: element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      }))
    return {
      horizontalOverflow: root.scrollWidth > root.clientWidth,
      undersized: enabledTargets.filter((target) => target.width < 43.5 || target.height < 43.5),
    }
  })
  expect(health.horizontalOverflow).toBe(false)
  expect(health.undersized).toEqual([])

  const axe = await new AxeBuilder({ page }).analyze()
  const serious = axe.violations.filter((violation) => (
    violation.impact === 'serious' || violation.impact === 'critical'
  ))
  expect(serious).toEqual([])
}

async function waitForAnimations(
  page: import('@playwright/test').Page,
  selector: string,
): Promise<void> {
  await page.locator(selector).evaluate(async (element) => {
    const animations = element.getAnimations({ subtree: true })
    await Promise.all(animations.map((animation) => animation.finished.catch(() => undefined)))
  })
}
