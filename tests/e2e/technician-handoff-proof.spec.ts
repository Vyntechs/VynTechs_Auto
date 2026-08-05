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
  timerEnabled: false,
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

function workProjection(overrides: Record<string, unknown> = {}) {
  return {
    changed: true,
    work: {
      status: 'in_progress',
      workNotes: null,
      startedAt: RUNNING_AT,
      completedAt: null,
      clockedOnSince: null,
      activeSeconds: 0,
      updatedAt: RUNNING_AT,
      timerEnabled: false,
      ...overrides,
    },
  }
}

test('timer-off technician claims starts and completes approved work without typing', async ({ context, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-timer-off-complete`)
  const network = await installNetworkBoundary(context, page)
  const ledger: LedgerEntry[] = []
  const unhandled: string[] = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const body = request.postData() ? request.postDataJSON() : undefined
    ledger.push({ scenario: 'timer-off-complete', method, path, body })
    if (method === 'POST' && path.endsWith('/assignment')) {
      await route.fulfill({ status: 200, json: assignment() })
      return
    }
    if (method === 'GET' && path.endsWith('/work')) {
      await route.fulfill({ status: 200, json: { workspace, partRequests: [] } })
      return
    }
    if (method === 'POST' && path.endsWith('/work')) {
      if ((body as { action?: string } | undefined)?.action === 'start_work') {
        await route.fulfill({ status: 200, json: workProjection() })
        return
      }
      if ((body as { action?: string } | undefined)?.action === 'complete') {
        await route.fulfill({
          status: 200,
          json: workProjection({
            status: 'done',
            workNotes: 'Completed as approved.',
            completedAt: '2026-08-04T20:12:00.000Z',
            updatedAt: '2026-08-04T20:12:00.000Z',
          }),
        })
        return
      }
    }
    if (method === 'GET' && path === '/api/today/jobs') {
      await route.fulfill({
        status: 200,
        json: {
          todayJobs: {
            myJobs: [], openJobs: [], createdJobs: [], teamJobs: [], partsJobs: [],
            readyToCollect: [], linkedSessionIds: [], hasMore: false,
          },
        },
      })
      return
    }
    unhandled.push(`${method} ${path}`)
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  })

  await page.goto('/approved-unassigned')
  await page.getByRole('button', { name: 'Claim work' }).click()
  const scope = page.getByRole('heading', { name: 'Exactly what is approved' })
  await expect(scope).toBeFocused()
  await expect(page.getByRole('button', { name: 'Start work', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /clock/i })).toHaveCount(0)
  await expect(page.getByText(/Clock running since/)).toHaveCount(0)
  expect(ledger).toHaveLength(2)
  expect(ledger[0]).toMatchObject({ method: 'POST', path: `/api/tickets/${TICKET}/jobs/${JOB}/assignment` })
  expect(ledger[0].body).toMatchObject({ action: 'claim', expectedApprovalState: 'approved' })
  expect((ledger[0].body as { requestKey: string }).requestKey).toMatch(/^[0-9a-f-]{36}$/)
  expect(ledger[1]).toMatchObject({ method: 'GET', path: `/api/tickets/${TICKET}/jobs/${JOB}/work` })
  await expectActiveInlineTools(page, 1)

  await page.getByRole('button', { name: 'Start work', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Work in progress' })).toBeFocused()
  expect(ledger[2]).toMatchObject({
    method: 'POST',
    path: `/api/tickets/${TICKET}/jobs/${JOB}/work`,
    body: { action: 'start_work', expectedUpdatedAt: workspace.updatedAt },
  })
  await expect(page.getByRole('button', { name: 'Complete as approved' })).toBeVisible()
  await expect(page.getByText(/\bnotes?\b/i)).toHaveCount(0)

  await page.getByRole('button', { name: 'Complete as approved' }).click()
  await expect(page.getByRole('heading', { name: 'Work complete' })).toBeFocused()
  await expect(page.getByText('Completed as approved.')).toBeVisible()
  const completedRow = page.getByRole('article', {
    name: 'Repair order 804: Replace front brakes and inspect rotors',
  })
  await expect(completedRow.getByText('Complete')).toBeVisible()
  await expectActiveInlineTools(page, 1)
  expect(ledger[3]).toMatchObject({
    method: 'POST',
    path: `/api/tickets/${TICKET}/jobs/${JOB}/work`,
    body: {
      action: 'complete',
      expectedUpdatedAt: RUNNING_AT,
      completion: { kind: 'as_approved' },
    },
  })
  const opened = page.locator('[data-work-open="true"]')
  await expect(opened).toHaveCSS('border-left-width', '2px')
  await expect(opened).toHaveCSS('transition-duration', '0.2s')
  await expectVisibleInteractiveTargetsAtLeast44(page, 'approved claim handoff')
  await expectNoTechnicianPriceLeakage(page)
  await expectNoHorizontalOverflow(page)
  await checkpoint(page, testInfo, `${testInfo.project.name}-timer-off-complete-normal-motion`)

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(opened).toHaveCSS('border-left-width', '2px')
  await expect(opened).toHaveCSS('transition-duration', '0s')
  await expect(opened).toHaveCSS('transform', 'none')
  await checkpoint(page, testInfo, `${testInfo.project.name}-timer-off-complete-reduced-motion`)
  await page.getByRole('button', { name: 'Close work' }).click()
  await expect(completedRow).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Work in the shop' })).toBeFocused()
  expect(ledger.at(-1)).toMatchObject({ method: 'GET', path: '/api/today/jobs' })
  expect(unhandled).toEqual([])
  expect(network.disallowed).toEqual([])
  expect(network.sockets).toEqual([])
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
  expect(faults.failedRequests).toEqual([])
})

test('optional detail completes atomically without a separate save step', async ({ context, page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-optional-detail`)
  const network = await installNetworkBoundary(context, page)
  const ledger: LedgerEntry[] = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const body = request.postData() ? request.postDataJSON() : undefined
    ledger.push({ scenario: 'optional-detail', method, path, body })
    if (method === 'GET' && path.endsWith('/work')) {
      await route.fulfill({
        status: 200,
        json: {
          workspace: {
            ...workspace,
            workStatus: 'in_progress',
            startedAt: RUNNING_AT,
            updatedAt: RUNNING_AT,
          },
          partRequests: [],
        },
      })
      return
    }
    if (method === 'POST' && path.endsWith('/work')) {
      await route.fulfill({
        status: 200,
        json: workProjection({
          status: 'done',
          workNotes: 'Measured final rotor runout at 0.0015 inch.',
          completedAt: '2026-08-04T20:12:00.000Z',
          updatedAt: '2026-08-04T20:12:00.000Z',
        }),
      })
      return
    }
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  })

  await page.goto('/optional-detail')
  await page.getByRole('button', { name: 'Review & start work' }).click()
  await expect(page.getByRole('heading', { name: 'Work in progress' })).toBeFocused()
  expect(ledger).toEqual([expect.objectContaining({ method: 'GET' })])
  await page.getByRole('button', { name: 'Add detail' }).click()
  await page.getByRole('textbox', { name: 'Anything worth recording? (optional)' })
    .fill('  Measured final rotor runout at 0.0015 inch.  ')
  await page.getByRole('button', { name: 'Complete with detail' }).click()
  await expect(page.getByRole('heading', { name: 'Work complete' })).toBeFocused()
  expect(ledger[1]).toMatchObject({
    method: 'POST',
    body: {
      action: 'complete',
      expectedUpdatedAt: RUNNING_AT,
      completion: {
        kind: 'with_details',
        details: 'Measured final rotor runout at 0.0015 inch.',
      },
    },
  })
  expect(ledger.filter((entry) => entry.method === 'POST')).toHaveLength(1)
  await expectActiveInlineTools(page, 1)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'optional detail completion')
  await expectNoTechnicianPriceLeakage(page)
  await expectNoHorizontalOverflow(page)
  await checkpoint(page, testInfo, `${testInfo.project.name}-optional-detail`)
  expect(ledger.map((entry) => entry.method)).toEqual(['GET', 'POST'])
  expect(network.disallowed).toEqual([])
  expect(network.sockets).toEqual([])
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
  expect(faults.failedRequests).toEqual([])
})

test('personal timer starts pauses resumes and remains stoppable after preference off', async ({ context, page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-personal-timer`)
  const network = await installNetworkBoundary(context, page)
  const ledger: LedgerEntry[] = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const body = request.postData() ? request.postDataJSON() : undefined
    ledger.push({ scenario: 'personal-timer', method, path, body })
    if (method === 'GET' && path.endsWith('/work')) {
      await route.fulfill({
        status: 200,
        json: { workspace: { ...workspace, timerEnabled: true }, partRequests: [] },
      })
      return
    }
    if (method === 'POST' && path.endsWith('/work')) {
      const action = (body as { action?: string } | undefined)?.action
      if (action === 'start_work') {
        await route.fulfill({ status: 200, json: workProjection({ clockedOnSince: RUNNING_AT, timerEnabled: true }) })
        return
      }
      if (action === 'clock_off') {
        const finalStop = ledger.filter((entry) => entry.body && (entry.body as { action?: string }).action === 'clock_off').length > 1
        await route.fulfill({
          status: 200,
          json: workProjection({
            clockedOnSince: null,
            activeSeconds: finalStop ? 420 : 300,
            updatedAt: finalStop ? '2026-08-04T20:07:00.000Z' : '2026-08-04T20:05:00.000Z',
            timerEnabled: !finalStop,
          }),
        })
        return
      }
      if (action === 'clock_on') {
        await route.fulfill({
          status: 200,
          json: workProjection({
            clockedOnSince: '2026-08-04T20:06:00.000Z',
            activeSeconds: 300,
            updatedAt: '2026-08-04T20:06:00.000Z',
            timerEnabled: false,
          }),
        })
        return
      }
    }
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  })

  await page.goto('/personal-timer')
  await page.getByRole('button', { name: 'Review & start work' }).click()
  await page.getByRole('button', { name: 'Start work', exact: true }).click()
  await expect(page.getByText(/Running since/)).toBeVisible()
  await expect(page.getByText(/not payroll/i)).toBeVisible()
  await page.getByRole('button', { name: 'Add detail' }).click()
  const detail = page.getByRole('textbox', { name: 'Anything worth recording? (optional)' })
  await detail.fill('Torque values are ready for the road test.')

  await page.getByRole('button', { name: 'Clock off' }).click()
  await expect(page.getByText('Paused')).toBeVisible()
  await expect(detail).toHaveValue('Torque values are ready for the road test.')
  await page.getByRole('button', { name: 'Clock on' }).click()
  await expect(page.getByRole('button', { name: 'Clock off' })).toBeVisible()
  await expect(detail).toHaveValue('Torque values are ready for the road test.')

  await page.getByRole('button', { name: 'Clock off' }).click()
  await expect(page.getByRole('button', { name: /Clock on|Clock off/ })).toHaveCount(0)
  await expect(detail).toHaveValue('Torque values are ready for the road test.')
  expect(ledger.map((entry) => (entry.body as { action?: string } | undefined)?.action).filter(Boolean))
    .toEqual(['start_work', 'clock_off', 'clock_on', 'clock_off'])
  await expectVisibleInteractiveTargetsAtLeast44(page, 'personal timer')
  await expectNoTechnicianPriceLeakage(page)
  await expectNoHorizontalOverflow(page)
  await checkpoint(page, testInfo, `${testInfo.project.name}-personal-timer`)
  expect(network.disallowed).toEqual([])
  expect(network.sockets).toEqual([])
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
  expect(faults.failedRequests).toEqual([])
})

test('detail survives reload and keeps both versions when saved work changed elsewhere', async ({ context, page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-detail-conflict`)
  const network = await installNetworkBoundary(context, page)
  let workspaceLoads = 0
  await page.route('**/api/**', async (route) => {
    const method = route.request().method()
    const path = new URL(route.request().url()).pathname
    if (method === 'GET' && path.endsWith('/work')) {
      workspaceLoads += 1
      await route.fulfill({
        status: 200,
        json: {
          workspace: {
            ...workspace,
            workStatus: 'in_progress',
            workNotes: workspaceLoads === 1 ? 'Original saved detail.' : 'Saved elsewhere.',
            startedAt: RUNNING_AT,
            updatedAt: workspaceLoads === 1 ? RUNNING_AT : '2026-08-04T20:08:00.000Z',
          },
          partRequests: [],
        },
      })
      return
    }
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  })

  await page.goto('/detail-conflict')
  await page.getByRole('button', { name: 'Review & start work' }).click()
  await page.getByRole('button', { name: 'Add detail' }).click()
  await page.getByRole('textbox', { name: 'Anything worth recording? (optional)' })
    .fill('My measured detail.')

  await page.reload()
  await page.getByRole('button', { name: 'Review & start work' }).click()
  await expect(page.getByText('Your detail')).toBeVisible()
  await expect(page.getByText('My measured detail.')).toBeVisible()
  await expect(page.getByText('Saved elsewhere', { exact: true })).toBeVisible()
  await expect(page.getByText('Saved elsewhere.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use my detail' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Use saved detail' })).toBeVisible()
  expect(workspaceLoads).toBe(2)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'detail conflict recovery')
  await expectNoTechnicianPriceLeakage(page)
  await expectNoHorizontalOverflow(page)
  await checkpoint(page, testInfo, `${testInfo.project.name}-detail-conflict`)
  expect(network.disallowed).toEqual([])
  expect(network.sockets).toEqual([])
  expect(faults.pageErrors).toEqual([])
  expect(faults.consoleErrors).toEqual([])
  expect(faults.failedRequests).toEqual([])
})

test('ambiguous Start work response reconciles current server truth before reporting', async ({ context, page }, testInfo) => {
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-ambiguous-start`)
  const network = await installNetworkBoundary(context, page)
  const ledger: LedgerEntry[] = []
  let workGets = 0
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const body = request.postData() ? request.postDataJSON() : undefined
    ledger.push({ scenario: 'ambiguous-start', method, path, body })
    if (method === 'GET' && path.endsWith('/work')) {
      workGets += 1
      await route.fulfill({
        status: 200,
        json: {
          workspace: workGets === 1
            ? workspace
            : { ...workspace, workStatus: 'in_progress', startedAt: RUNNING_AT, updatedAt: RUNNING_AT },
          partRequests: [],
        },
      })
      return
    }
    if (method === 'POST' && path.endsWith('/work')) {
      await route.fulfill({ status: 200, json: { ok: true } })
      return
    }
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  })

  await page.goto('/ambiguous-start')
  await page.getByRole('button', { name: 'Review & start work' }).click()
  await page.getByRole('button', { name: 'Start work', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Work in progress' })).toBeFocused()
  expect(ledger.map((entry) => entry.method)).toEqual(['GET', 'POST', 'GET'])
  expect(ledger[1].body).toMatchObject({ action: 'start_work' })
  await expectVisibleInteractiveTargetsAtLeast44(page, 'ambiguous start recovery')
  await expectNoTechnicianPriceLeakage(page)
  await expectNoHorizontalOverflow(page)
  await checkpoint(page, testInfo, `${testInfo.project.name}-ambiguous-start`)
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
  await page.getByRole('button', { name: 'Review & start work' }).click()
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
  await page.getByRole('button', { name: 'Review & start work' }).click()
  await expect(page.getByRole('heading', { name: 'Exactly what is approved' })).toBeFocused()
  await page.getByRole('button', { name: 'Start work', exact: true }).click()
  const staleHeading = page.getByRole('heading', { name: 'Work access changed' })
  await expect(staleHeading).toBeFocused()
  await expect(page.getByText('Waiting for customer')).toBeVisible()
  await expect(page.getByRole('button', { name: /Start work|Clock on|Clock off|Clock back on/ })).toHaveCount(0)
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
