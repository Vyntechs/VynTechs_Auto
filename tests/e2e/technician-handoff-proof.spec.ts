import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import {
  checkpoint,
  watchBrowserFaults,
} from './golden-browser-receipts'

const ORIGIN = 'http://127.0.0.1:4173'
const TICKET = '00000000-0000-4000-8000-000000000601'
const JOB = '00000000-0000-4000-8000-000000000701'
const RUNNING_AT = '2026-08-04T20:01:00.000Z'

const workspace = {
  id: JOB,
  title: 'Replace front brakes and inspect rotors',
  kind: 'maintenance' as const,
  workStatus: 'open' as const,
  workNotes: null,
  startedAt: null,
  completedAt: null,
  clockedOnSince: null,
  activeSeconds: 0,
  updatedAt: '2026-08-04T20:00:00.000Z',
  authorization: 'approved' as const,
  approvedScope: {
    authorizationPurpose: null,
    customerSuppliedPartsNote: null,
    lines: [{
      kind: 'labor' as const,
      description: 'Replace front brake pads, inspect both rotors, clean the hub faces, and verify the repair on a road test',
      hours: '2.0',
    }],
  },
}

const deferredTodayJob = {
  id: JOB,
  ticketId: TICKET,
  ticketNumber: 804,
  concern: 'Brake vibration under light pedal pressure',
  customerName: 'Marisol Vega',
  vehicle: { year: 2019, make: 'Ford', model: 'F-150' },
  title: 'Replace front brakes and inspect rotors',
  kind: 'maintenance' as const,
  requiredSkillTier: 2,
  sessionId: null,
  workStatus: 'open' as const,
  clockedOnSince: null,
  approvalState: 'deferred' as const,
  canClaim: false,
  assignmentState: 'mine' as const,
  assignedTechName: 'Taylor Tech',
  createdByMe: false,
  diagnosticStartErrorCode: null,
  attentionAt: '2026-08-04T15:00:00.000Z',
}

const approvedOpenTodayJob = {
  ...deferredTodayJob,
  approvalState: 'approved' as const,
  canClaim: true,
  assignmentState: 'unassigned' as const,
  assignedTechName: null,
}

type LedgerEntry = { scenario: string; method: string; path: string; body?: unknown }

async function installNetworkBoundary(context: BrowserContext, page: Page) {
  const disallowed: string[] = []
  const sockets: string[] = []
  await page.exposeFunction('__recordBlockedTechnicianHandoffSocket', (rawUrl: string) => {
    const url = new URL(rawUrl)
    sockets.push(`${url.origin}${url.pathname}`)
  })
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    window.WebSocket = class LoopbackOnlyWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const parsed = new URL(String(url), window.location.href)
        if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '4173') {
          void (window as unknown as {
            __recordBlockedTechnicianHandoffSocket: (value: string) => Promise<void>
          }).__recordBlockedTechnicianHandoffSocket(parsed.href)
          throw new DOMException('non-loopback WebSocket refused', 'SecurityError')
        }
        super(url, protocols)
      }
    }
  })
  await context.route('**/*', async (route) => {
    const url = route.request().url()
    if (url.startsWith(`${ORIGIN}/`) || url.startsWith('data:') || url.startsWith('blob:')) {
      await route.fallback()
      return
    }
    if (/^https?:/i.test(url)) {
      const blocked = new URL(url)
      disallowed.push(`${blocked.origin}${blocked.pathname}`)
      await route.abort('blockedbyclient')
      return
    }
    await route.fallback()
  })
  page.on('websocket', (socket) => {
    if (!socket.url().startsWith('ws://127.0.0.1:4173/')) {
      const blocked = new URL(socket.url())
      sockets.push(`${blocked.origin}${blocked.pathname}`)
    }
  })
  return { disallowed, sockets }
}

async function expectVisibleInteractiveTargetsAtLeast44(page: Page, label: string) {
  const targets = await page.locator([
    'a[href]',
    'button:enabled',
    '[role="button"]:not([aria-disabled="true"])',
  ].join(',')).evaluateAll((elements) => elements.flatMap((element) => {
    const html = element as HTMLElement
    const style = getComputedStyle(html)
    const rect = html.getBoundingClientRect()
    if (style.display === 'none' || style.visibility === 'hidden'
      || rect.width === 0 || rect.height === 0) return []
    return [{
      name: html.getAttribute('aria-label') ?? html.textContent?.replace(/\s+/g, ' ').trim(),
      width: rect.width,
      height: rect.height,
    }]
  }))
  expect(
    // Chromium can report a CSS 44px box a few millionths below 44 after
    // sub-pixel layout. Keep the product threshold while ignoring renderer noise.
    targets.filter((target) => target.width < 43.99 || target.height < 43.99),
    `${label} has no visible enabled interactive target below 44px`,
  ).toEqual([])
}

async function expectNoTechnicianPriceLeakage(page: Page) {
  const text = await page.locator('body').innerText()
  expect(text).not.toMatch(/\$\s*\d|Build quote|Prepare quote|Quote total|Customer will see/i)
}

async function expectNoHorizontalOverflow(page: Page) {
  await expect.poll(async () => page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))).toEqual(expect.objectContaining({
    clientWidth: page.viewportSize()?.width,
    scrollWidth: page.viewportSize()?.width,
  }))
}

async function expectActiveInlineTools(page: Page, count: number) {
  await expect(page.getByLabel('Work on this job')).toHaveCount(count)
}

function assignment() {
  return {
    assignment: {
      ticketId: TICKET,
      jobId: JOB,
      workStatus: 'open',
      state: 'mine',
      assignedTechName: 'Taylor Tech',
      approvalState: 'approved',
    },
  }
}

function runningWork() {
  return {
    changed: true,
    work: {
      status: 'in_progress',
      workNotes: null,
      startedAt: RUNNING_AT,
      completedAt: null,
      clockedOnSince: RUNNING_AT,
      activeSeconds: 0,
      updatedAt: RUNNING_AT,
    },
  }
}

test('approved unassigned Claim work opens exact scope before deliberate Clock on', async ({ context, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-approved-unassigned`)
  const network = await installNetworkBoundary(context, page)
  const ledger: LedgerEntry[] = []
  const unhandled: string[] = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const body = request.postData() ? request.postDataJSON() : undefined
    ledger.push({ scenario: 'approved-unassigned', method, path, body })
    if (method === 'POST' && path.endsWith('/assignment')) {
      await route.fulfill({ status: 200, json: assignment() })
      return
    }
    if (method === 'GET' && path.endsWith('/work')) {
      await route.fulfill({ status: 200, json: { workspace, partRequests: [] } })
      return
    }
    if (method === 'POST' && path.endsWith('/work')) {
      await route.fulfill({ status: 200, json: runningWork() })
      return
    }
    unhandled.push(`${method} ${path}`)
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  })

  await page.goto('/approved-unassigned')
  await page.getByRole('button', { name: 'Claim work' }).click()
  const scope = page.getByRole('heading', { name: 'Exactly what is approved' })
  await expect(scope).toBeFocused()
  await expect(page.getByRole('button', { name: 'Clock on', exact: true })).toBeVisible()
  await expect(page.getByText(/Clock running since/)).toHaveCount(0)
  expect(ledger).toHaveLength(2)
  expect(ledger[0]).toMatchObject({ method: 'POST', path: `/api/tickets/${TICKET}/jobs/${JOB}/assignment` })
  expect(ledger[0].body).toMatchObject({ action: 'claim', expectedApprovalState: 'approved' })
  expect((ledger[0].body as { requestKey: string }).requestKey).toMatch(/^[0-9a-f-]{36}$/)
  expect(ledger[1]).toMatchObject({ method: 'GET', path: `/api/tickets/${TICKET}/jobs/${JOB}/work` })
  await expectActiveInlineTools(page, 1)

  await page.getByRole('button', { name: 'Clock on', exact: true }).click()
  await expect(page.getByText(/Clock running since/).first()).toBeVisible()
  expect(ledger[2]).toMatchObject({
    method: 'POST', path: `/api/tickets/${TICKET}/jobs/${JOB}/work`, body: { action: 'clock_on' },
  })
  const opened = page.locator('[data-work-open="true"]')
  await expect(opened).toHaveCSS('border-left-width', '2px')
  await expect(opened).toHaveCSS('transition-duration', '0.2s')
  await expectVisibleInteractiveTargetsAtLeast44(page, 'approved claim handoff')
  await expectNoTechnicianPriceLeakage(page)
  await expectNoHorizontalOverflow(page)
  await checkpoint(page, testInfo, `${testInfo.project.name}-approved-unassigned-normal-motion`)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(opened).toHaveCSS('border-left-width', '2px')
  await expect(opened).toHaveCSS('transition-duration', '0s')
  await expect(opened).toHaveCSS('transform', 'none')
  await checkpoint(page, testInfo, `${testInfo.project.name}-approved-unassigned-reduced-motion`)
  expect(unhandled).toEqual([])
  expect(network.disallowed).toEqual([])
  expect(network.sockets).toEqual([])
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
  expect(faults.failedRequests).toEqual([])
})

test('approved preassigned Review and clock on opens exact scope before time', async ({ context, page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-approved-preassigned`)
  const network = await installNetworkBoundary(context, page)
  const ledger: LedgerEntry[] = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const body = request.postData() ? request.postDataJSON() : undefined
    ledger.push({ scenario: 'approved-preassigned', method, path, body })
    if (method === 'GET' && path.endsWith('/work')) {
      await route.fulfill({ status: 200, json: { workspace, partRequests: [] } })
      return
    }
    if (method === 'POST' && path.endsWith('/work')) {
      await route.fulfill({ status: 200, json: runningWork() })
      return
    }
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  })

  await page.goto('/approved-preassigned')
  await page.getByRole('button', { name: 'Review & clock on' }).click()
  await expect(page.getByRole('heading', { name: 'Exactly what is approved' })).toBeFocused()
  await expect(page.getByText(/Clock running since/)).toHaveCount(0)
  expect(ledger).toEqual([expect.objectContaining({ method: 'GET' })])
  await page.getByRole('button', { name: 'Clock on', exact: true }).click()
  await expect(page.getByText(/Clock running since/).first()).toBeVisible()
  await expectActiveInlineTools(page, 1)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'preassigned handoff')
  await expectNoTechnicianPriceLeakage(page)
  await expectNoHorizontalOverflow(page)
  await checkpoint(page, testInfo, `${testInfo.project.name}-approved-preassigned`)
  expect(ledger.map((entry) => entry.method)).toEqual(['GET', 'POST'])
  expect(network.disallowed).toEqual([])
  expect(network.sockets).toEqual([])
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
  expect(faults.failedRequests).toEqual([])
})

test('state matrix explains waiting below-tier and customer outcomes without forbidden action', async ({ context, page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-state-matrix`)
  const network = await installNetworkBoundary(context, page)
  const apiCalls: string[] = []
  await page.route('**/api/**', async (route) => {
    apiCalls.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    await route.fulfill({ status: 599, json: { error: 'unexpected_api_call' } })
  })

  await page.goto('/state-matrix')
  await expect(page.getByText('Waiting for quote')).toBeVisible()
  await expect(page.getByText('Requires A-tech')).toBeVisible()
  await expect(page.getByText('Waiting for customer')).toBeVisible()
  await expect(page.getByText('Customer declined', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Claim work' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /clock/i })).toHaveCount(0)
  await expectActiveInlineTools(page, 0)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'state truth')
  await expectNoTechnicianPriceLeakage(page)
  await expectNoHorizontalOverflow(page)
  await checkpoint(page, testInfo, `${testInfo.project.name}-state-matrix`)
  expect(apiCalls).toEqual([])
  expect(network.disallowed).toEqual([])
  expect(network.sockets).toEqual([])
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
  expect(faults.failedRequests).toEqual([])
})

test('recovery keeps races retries load failures and stale mounted access truthful', async ({ context, page }, testInfo) => {
  test.setTimeout(60_000)
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-recovery`)
  const network = await installNetworkBoundary(context, page)
  const ledger: LedgerEntry[] = []
  const unhandled: string[] = []
  let scenario = 'race'
  let replayAttempts = 0
  await page.route('**/api/**', async (route: Route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const body = request.postData() ? request.postDataJSON() : undefined
    ledger.push({ scenario, method, path, body })

    if (scenario === 'race' && method === 'POST' && path.endsWith('/assignment')) {
      await route.fulfill({
        status: 409,
        json: { error: 'assignment_conflict', currentAssignee: { fullName: 'Avery Tech' } },
      })
      return
    }
    if (scenario === 'replay' && method === 'POST' && path.endsWith('/assignment')) {
      replayAttempts += 1
      if (replayAttempts === 1) {
        await route.fulfill({ status: 503, json: { error: 'unavailable' } })
      } else {
        await route.fulfill({ status: 200, json: assignment() })
      }
      return
    }
    if (scenario === 'replay' && method === 'GET' && path === '/api/today/jobs') {
      await route.fulfill({
        status: 200,
        json: {
          todayJobs: {
            myJobs: [], openJobs: [approvedOpenTodayJob], createdJobs: [], teamJobs: [], partsJobs: [],
            readyToCollect: [], linkedSessionIds: [], hasMore: false,
          },
        },
      })
      return
    }
    if (scenario === 'load' && method === 'GET' && path.endsWith('/work')) {
      await route.fulfill({ status: 503, json: { error: 'unavailable' } })
      return
    }
    if (scenario === 'stale' && method === 'GET' && path.endsWith('/work')) {
      await route.fulfill({ status: 200, json: { workspace, partRequests: [] } })
      return
    }
    if (scenario === 'stale' && method === 'POST' && path.endsWith('/work')) {
      await route.fulfill({ status: 404, json: { error: 'not_found' } })
      return
    }
    if (scenario === 'stale' && method === 'GET' && path === '/api/today/jobs') {
      await route.fulfill({
        status: 200,
        json: {
          todayJobs: {
            myJobs: [deferredTodayJob], openJobs: [], createdJobs: [], teamJobs: [], partsJobs: [],
            readyToCollect: [], linkedSessionIds: [], hasMore: false,
          },
        },
      })
      return
    }
    if (scenario === 'replay' && method === 'GET' && path.endsWith('/work')) {
      await route.fulfill({ status: 200, json: { workspace, partRequests: [] } })
      return
    }
    unhandled.push(`${scenario} ${method} ${path}`)
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  })

  await page.goto('/recovery-race')
  await page.getByRole('button', { name: 'Claim work' }).click()
  await expect(page.getByRole('status')).toContainText('Already claimed by Avery Tech')
  await expect(page.getByRole('button', { name: 'Claim work' })).toHaveCount(0)
  await checkpoint(page, testInfo, `${testInfo.project.name}-recovery-race`)

  scenario = 'replay'
  await page.goto('/recovery-replay')
  await page.getByRole('button', { name: 'Claim work' }).click()
  await expect(page.getByRole('alert')).toContainText("Couldn't claim ticket 804. Try again.")
  await page.getByRole('button', { name: 'Claim work' }).click()
  await expect(page.getByRole('heading', { name: 'Exactly what is approved' })).toBeFocused()
  const replayBodies = ledger
    .filter((entry) => entry.scenario === 'replay' && entry.path.endsWith('/assignment'))
    .map((entry) => entry.body)
  expect(replayBodies).toHaveLength(2)
  expect(replayBodies[0]).toEqual(replayBodies[1])
  await page.getByRole('button', { name: 'Close work' }).click()
  await checkpoint(page, testInfo, `${testInfo.project.name}-recovery-replay`)

  scenario = 'load'
  await page.goto('/recovery-load')
  await page.getByRole('button', { name: 'Review & clock on' }).click()
  const loadFailure = page.getByRole('alert')
  await expect(loadFailure).toContainText('Work could not be opened here')
  await expect(loadFailure).toBeFocused()
  await expect(page.getByRole('button', { name: 'Retry work' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Open the full work page' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Close' })).toBeVisible()
  await expectVisibleInteractiveTargetsAtLeast44(page, 'work-load recovery')
  await checkpoint(page, testInfo, `${testInfo.project.name}-recovery-load`)

  scenario = 'stale'
  await page.goto('/recovery-stale')
  await page.getByRole('button', { name: 'Review & clock on' }).click()
  await expect(page.getByRole('heading', { name: 'Exactly what is approved' })).toBeFocused()
  await page.getByRole('button', { name: 'Clock on', exact: true }).click()
  const staleHeading = page.getByRole('heading', { name: 'Work access changed' })
  await expect(staleHeading).toBeFocused()
  await expect(page.getByText('Waiting for customer')).toBeVisible()
  await expect(page.getByRole('button', { name: /Clock on|Clock off|Clock back on/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Work note' })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Complete work' })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Review repair order' })).toBeVisible()
  await expectActiveInlineTools(page, 1)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'stale mounted recovery')
  await expectNoTechnicianPriceLeakage(page)
  await expectNoHorizontalOverflow(page)
  await checkpoint(page, testInfo, `${testInfo.project.name}-recovery-stale`)

  expect(network.disallowed).toEqual([])
  expect(network.sockets).toEqual([])
  expect(unhandled).toEqual([])
  expect(faults.pageErrors).toEqual([])
  expect(faults.failedRequests).toEqual([])
  expect(faults.consoleErrors.filter((message) => (
    !/status of (404|409|503)/.test(message)
  ))).toEqual([])
})
