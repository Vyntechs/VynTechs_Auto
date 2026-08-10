import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  assertNoBrowserFaults,
  watchBrowserFaults,
} from './golden-browser-receipts'
import { IMPLEMENTATION_JOB_ID } from './living-repair-order-harness/implementation-constants'

const evidenceDirectory = resolve(process.cwd(), 'test-results/parts-arrival-handoff')
const jobId = IMPLEMENTATION_JOB_ID
const versionId = '00000000-0000-4000-8000-000000003100'
const padsId = '00000000-0000-4000-8000-000000003101'
const rotorId = '00000000-0000-4000-8000-000000003102'
const ordered = { actorName: 'Pat Parts', at: '2026-08-09T19:20:00.000Z' }
const received = { actorName: 'Alex Advisor', at: '2026-08-09T19:42:00.000Z' }

test.beforeAll(async () => {
  await mkdir(evidenceDirectory, { recursive: true })
})

test('advances the partial repair order to all parts here without releasing its hold', async ({ page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-parts-arrival`)
  const outsideFetches: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() !== 'fetch') return
    if (new URL(request.url()).origin !== 'http://127.0.0.1:4183') outsideFetches.push(request.url())
  })
  let writes = 0
  await page.route('**/api/tickets/**/parts-arrival/**', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    writes += 1
    expect(route.request().postDataJSON()).toEqual({ action: 'mark_received' })
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ changed: true, job: allHereJob(false) }),
    })
  })

  await page.goto(implementationUrl('advisor', 'parts-partial'))
  const job = page.getByRole('listitem', { name: 'Job correction target 01' })
  const arrival = job.getByRole('region', { name: 'Parts arrival' })
  await expect(arrival.getByText('1 of 2 received')).toBeVisible()
  await expect(arrival.getByText('Front brake pad set')).toBeVisible()
  await expect(arrival.getByText('Front brake rotor')).toBeVisible()
  await expect(arrival.getByText('Ordered by Pat Parts').first()).toBeVisible()
  await expect(arrival.getByRole('button', { name: 'Mark Front brake rotor received' })).toBeVisible()
  await assertSurfaceHealth(page)
  await screenshot(page, testInfo.project.name, 'partial')

  await arrival.getByRole('button', { name: 'Mark Front brake rotor received' }).click()
  await expect(arrival.getByText('All parts here')).toBeVisible()
  await expect(arrival.getByText('Work stays on hold until someone resumes it.')).toBeVisible()
  await expect(job.locator('[data-state="blocked"]').filter({ hasText: 'On hold' })).toBeVisible()
  await expect(arrival.getByRole('button')).toHaveCount(0)
  await expect(page.locator('body')).toHaveAttribute('data-route-changes', '0')
  await expect(arrival.getByText('Front brake rotor').locator('xpath=ancestor::li[1]')).toBeFocused()
  await assertSurfaceHealth(page)
  await screenshot(page, testInfo.project.name, 'all-here')

  expect(writes).toBe(1)
  expect(outsideFetches).toEqual([])
  assertNoBrowserFaults([faults])
})

test('shows the assigned technician the same truthful state without mutation authority', async ({ page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-parts-arrival-tech`)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(implementationUrl('tech', 'parts-partial'))
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true)
  const arrival = page.getByRole('region', { name: 'Parts arrival' })
  await expect(arrival.getByText('Read-only for technicians')).toBeVisible()
  await expect(arrival.getByText('1 of 2 received')).toBeVisible()
  await expect(arrival.getByText('Front brake rotor')).toBeVisible()
  await expect(arrival.getByRole('button')).toHaveCount(0)
  await assertSurfaceHealth(page)
  await screenshot(page, testInfo.project.name, 'technician-read-only')
  assertNoBrowserFaults([faults])
})

function implementationUrl(role: 'advisor' | 'tech', state: 'parts-partial' | 'parts-all'): string {
  const query = new URLSearchParams({ mode: 'implementation', role, state })
  return `/?${query.toString()}`
}

function allHereJob(readOnly: boolean) {
  return {
    jobId,
    approvedQuoteVersionId: versionId,
    title: 'Front brake service',
    readOnly,
    receivedCount: 2,
    totalCount: 2,
    allHere: true,
    lines: [
      {
        id: padsId, description: 'Front brake pad set', quantity: '1', partNumber: 'BRF-2147', brand: 'Brembo',
        state: 'received', nextAction: null, ordered, received,
      },
      {
        id: rotorId, description: 'Front brake rotor', quantity: '2', partNumber: 'BRR-8821', brand: 'Brembo',
        state: 'received', nextAction: null, ordered, received,
      },
    ],
  }
}

async function screenshot(page: Page, project: string, state: string) {
  await page.screenshot({
    path: resolve(evidenceDirectory, `${project}-${state}.png`),
    fullPage: project.includes('phone'),
  })
}

async function assertSurfaceHealth(page: Page): Promise<void> {
  const health = await page.evaluate(() => {
    const root = document.documentElement
    const enabled = [...document.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], summary')]
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
      undersized: enabled.filter((target) => target.width < 43.5 || target.height < 43.5),
    }
  })
  expect(health.horizontalOverflow).toBe(false)
  expect(health.undersized).toEqual([])
  const axe = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze()
  expect(axe.violations.filter((violation) => (
    violation.impact === 'serious' || violation.impact === 'critical'
  ))).toEqual([])
}
