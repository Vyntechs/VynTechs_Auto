import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  assertNoBrowserFaults,
  checkpoint,
  watchBrowserFaults,
} from './golden-browser-receipts'

const ORIGIN = 'http://127.0.0.1:4181'
const ACTOR = '00000000-0000-4000-8000-000000000100'
const TICKET = '00000000-0000-4000-8000-000000000101'
const CUSTOMER = '00000000-0000-4000-8000-000000000102'
const VEHICLE = '00000000-0000-4000-8000-000000000103'
const DIAGNOSTIC = '00000000-0000-4000-8000-000000000104'
const REPAIR = '00000000-0000-4000-8000-000000000105'
const VERSION = '00000000-0000-4000-8000-000000000106'
const ACTIVITY = '00000000-0000-4000-8000-000000000107'
const INITIAL_TIME = '2026-08-03T14:00:00.000Z'
const STALE_TIME = '2026-08-03T14:05:00.000Z'
const SAVED_TIME = '2026-08-03T14:10:00.000Z'

type LedgerEntry = {
  method: string
  path: string
  outcome: string
  epoch?: 'initial-correction-baseline' | 'conflict-refresh-baseline'
  body?: unknown
  requestKey?: string
}

class DeferredRouteGate {
  readonly armed: Promise<void>
  private readonly waitForRelease: Promise<void>
  private markArmed!: () => void
  private releaseWaiter!: () => void
  private released = false

  constructor() {
    this.armed = new Promise<void>((resolvePromise) => {
      this.markArmed = resolvePromise
    })
    this.waitForRelease = new Promise<void>((resolvePromise) => {
      this.releaseWaiter = resolvePromise
    })
  }

  async hold(): Promise<void> {
    this.markArmed()
    await this.waitForRelease
  }

  release(): void {
    if (this.released) return
    this.released = true
    this.releaseWaiter()
  }
}

function job(id: string, title: string, kind: 'diagnostic' | 'repair') {
  return {
    id, title, kind, requiredSkillTier: kind === 'diagnostic' ? 3 : 2,
    assignedTechId: null, assignedTech: null, sessionId: null,
    workStatus: 'open', approvalState: 'quote_ready', customerSuppliedPartsNote: null,
    workNotes: null, diagnosticStartState: 'idle', diagnosticStartErrorCode: null,
    createdAt: INITIAL_TIME, updatedAt: INITIAL_TIME,
  }
}

function initialTicket() {
  return {
    id: TICKET, ticketNumber: 81, source: 'counter', status: 'open',
    concern: 'Steering wheel shakes under braking.', whenStarted: null, howOften: null,
    diagnosticAuthorizedCents: 18_750,
    diagnosticAuthorizationNote: 'Diagnosis first; call before exceeding authorization.',
    customer: { id: CUSTOMER, name: 'Marisol Vega', phone: '214-555-0197', email: null },
    vehicle: {
      id: VEHICLE, year: 2019, make: 'Ford', model: 'F-150', engine: '3.5L',
      vin: '1FTFW1E41KFA00001', mileage: 88_420, plate: 'TEX-4192',
    },
    jobs: [
      job(DIAGNOSTIC, 'Diagnose brake vibration', 'diagnostic'),
      job(REPAIR, 'Replace front brake pads', 'repair'),
    ],
    activities: [] as Array<{
      id: string
      jobId: string | null
      kind: 'ticket_corrected'
      actorName: string
      summary: string
      correctionScope: 'concern'
      createdAt: string
    }>,
    createdAt: INITIAL_TIME, updatedAt: INITIAL_TIME,
  }
}

function quoteFor(ticket: ReturnType<typeof initialTicket>, activeVersion: boolean) {
  return {
    ticket: { id: TICKET, status: 'open', reconciled: false },
    configuration: {
      laborRateCents: 15_500, taxRateBps: 825, partsMarkupBps: 2_500,
      laborRateConfigured: true, taxRateConfigured: true,
    },
    jobs: ticket.jobs.map((item) => ({
      id: item.id, title: item.title, kind: item.kind,
      customerSuppliedPartsNote: item.customerSuppliedPartsNote,
      workStatus: item.workStatus,
      story: { content: null, source: null, reviewStatus: null, revision: 0 },
      storyMode: item.kind === 'diagnostic' ? 'authorization_only' : null, decisionEligible: true,
      approval: { state: item.approvalState, quoteVersionId: null },
      lines: [],
    })),
    capabilities: { canRecordCustomerApproval: true, canCreateCustomerApprovalLink: true },
    activeVersion: activeVersion ? {
      id: VERSION, versionNumber: 1, totalCents: 54_350,
      jobs: [
        { jobId: DIAGNOSTIC, subtotalCents: 18_750 },
        { jobId: REPAIR, subtotalCents: 35_600 },
      ],
    } : null,
  }
}

class SearchFixture {
  readonly pendingResponse = new DeferredRouteGate()
  readonly slowResponse = new DeferredRouteGate()
  readonly retryResponse = new DeferredRouteGate()
  readonly ledger: LedgerEntry[] = []
  readonly unhandled: string[] = []
  errorAttempts = 0

  async handle(route: Route): Promise<void> {
    const request = route.request()
    const path = new URL(request.url()).pathname
    const method = request.method()
    const body = request.postDataJSON() as { q?: unknown }

    if (method === 'POST' && path === '/api/intake/search' && body.q === 'pending proof') {
      this.ledger.push({
        method, path, outcome: 'pending-then-authoritative-no-match', body,
      })
      await this.pendingResponse.hold()
      await route.fulfill({ status: 200, json: { customers: [], vehicles: [], latencyMs: 3_000 } })
      return
    }
    if (method === 'POST' && path === '/api/intake/search' && body.q === 'slow proof') {
      this.ledger.push({
        method, path, outcome: 'slow-then-authoritative-no-match', body,
      })
      await this.slowResponse.hold()
      await route.fulfill({ status: 200, json: { customers: [], vehicles: [], latencyMs: 9_000 } })
      return
    }
    if (method === 'POST' && path === '/api/intake/search' && body.q === 'error proof') {
      this.errorAttempts += 1
      if (this.errorAttempts === 1) {
        this.ledger.push({ method, path, outcome: 'explicit-outage', body })
        await route.fulfill({ status: 503, json: { error: 'unavailable' } })
        return
      }
      if (this.errorAttempts === 2) {
        this.ledger.push({
          method, path, outcome: 'retry-authoritative-no-match', body,
        })
        await this.retryResponse.hold()
        await route.fulfill({ status: 200, json: { customers: [], vehicles: [], latencyMs: 4 } })
        return
      }
    }

    const label = `${method} ${path}`
    this.unhandled.push(label)
    this.ledger.push({ method, path, outcome: 'refused-unhandled-loopback-api' })
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  }

  releaseAll(): void {
    this.pendingResponse.release()
    this.slowResponse.release()
    this.retryResponse.release()
  }
}

class FinishCorrectionFixture {
  ticket: ReturnType<typeof initialTicket> | null = null
  activeVersion = true
  correctionPosts = 0
  counterPosts = 0
  completedVisualSaves = 0
  malformedQuoteReads = 0
  ticketReads = 0
  unseenCountReads = 0
  savedCorrectionKey: string | null = null
  counterRequestKey: string | null = null
  readonly ledger: LedgerEntry[] = []
  readonly whatsNewLedger: LedgerEntry[] = []
  readonly correctionRequestKeys: string[] = []
  readonly unhandled: string[] = []
  readonly savedCorrectionResponse = new DeferredRouteGate()

  record(entry: LedgerEntry): void {
    this.ledger.push(entry)
  }

  async handle(route: Route): Promise<void> {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    const path = url.pathname

    if (method === 'POST' && path === '/api/tickets/counter') {
      const body = request.postDataJSON() as Record<string, unknown>
      const key = body.clientKey
      expect(typeof key).toBe('string')
      expect(body).toEqual({
        clientKey: key,
        vehicleMode: 'new',
        customer: { name: 'Marisol Vega', phone: '214-555-0197', email: null },
        vehicle: {
          year: 2019, make: 'Ford', model: 'F-150', engine: null,
          vin: null, mileage: null, plate: null,
        },
        concern: 'Steering wheel shakes under braking.',
        whenStarted: null,
        howOften: null,
        work: {
          mode: 'diagnosis-manual', description: 'Diagnose brake vibration',
          laborHours: 1.25, priceCents: 18_750,
        },
        assignedTechId: null,
      })
      this.counterPosts += 1
      this.counterRequestKey = String(key)
      this.ticket = initialTicket()
      this.record({
        method,
        path,
        outcome: 'single-created-repair-order-and-install-resulting-two-job-state',
        body,
        requestKey: String(key),
      })
      await route.fulfill({ status: 201, json: { ticket: { id: TICKET } } })
      return
    }

    if (method === 'GET' && path === '/api/whats-new/unseen-count') {
      this.unseenCountReads += 1
      this.whatsNewLedger.push({ method, path, outcome: 'current-zero-unseen-count' })
      await route.fulfill({ status: 200, json: { count: 0 } })
      return
    }

    if (method === 'GET' && path === `/api/tickets/${TICKET}`) {
      if (!this.ticket) {
        this.unhandled.push(`${method} ${path} before create transition`)
        this.record({ method, path, outcome: 'refused-ticket-read-before-create-transition' })
        await route.fulfill({ status: 409, json: { error: 'ticket_not_created' } })
        return
      }
      this.ticketReads += 1
      const epoch = this.correctionPosts === 1
        ? 'conflict-refresh-baseline'
        : this.correctionPosts === 0 && this.ticketReads === 3
          ? 'initial-correction-baseline'
          : undefined
      this.record({ method, path, outcome: 'current-deterministic-ticket', epoch })
      await route.fulfill({ status: 200, json: { ticket: this.ticket } })
      return
    }

    if (method === 'GET' && path === `/api/tickets/${TICKET}/quote`) {
      if (!this.ticket) {
        this.unhandled.push(`${method} ${path} before create transition`)
        this.record({ method, path, outcome: 'refused-quote-read-before-create-transition' })
        await route.fulfill({ status: 409, json: { error: 'ticket_not_created' } })
        return
      }
      if (this.malformedQuoteReads > 0) {
        this.malformedQuoteReads -= 1
        this.record({ method, path, outcome: 'malformed-refresh-refused' })
        await route.fulfill({ status: 200, json: { builder: { malformed: true } } })
        return
      }
      const epoch = this.correctionPosts === 0
        ? 'initial-correction-baseline'
        : this.correctionPosts === 1
          ? 'conflict-refresh-baseline'
          : undefined
      this.record({ method, path, outcome: 'current-deterministic-quote', epoch })
      await route.fulfill({ status: 200, json: { builder: quoteFor(this.ticket, this.activeVersion) } })
      return
    }

    if (method === 'POST' && path === `/api/tickets/${TICKET}/corrections`) {
      const body = request.postDataJSON() as Record<string, unknown>
      expect(body.action).toBe('concern')
      expect(body.concern).toBe('Steering wheel clunks over bumps.')
      expect(typeof body.requestKey).toBe('string')
      this.correctionPosts += 1
      this.correctionRequestKeys.push(String(body.requestKey))
      if (!this.ticket) throw new Error('correction attempted before deterministic create transition')
      if (this.correctionPosts === 1) {
        expect(body).toEqual({
          action: 'concern',
          requestKey: body.requestKey,
          expectedTicketUpdatedAt: INITIAL_TIME,
          expectedActiveVersionId: VERSION,
          concern: 'Steering wheel clunks over bumps.',
        })
        this.ticket = { ...this.ticket, concern: 'Shop truth changed while editing.', updatedAt: STALE_TIME }
        this.record({ method, path, outcome: 'stale-conflict', body, requestKey: String(body.requestKey) })
        await route.fulfill({ status: 409, json: { error: 'conflict', retryable: false } })
        return
      }
      if (this.correctionPosts === 2) {
        expect(body).toEqual({
          action: 'concern',
          requestKey: body.requestKey,
          expectedTicketUpdatedAt: STALE_TIME,
          expectedActiveVersionId: VERSION,
          concern: 'Steering wheel clunks over bumps.',
        })
        expect(this.correctionRequestKeys.at(-1)).not.toBe(this.correctionRequestKeys.at(-2))
        this.savedCorrectionKey = String(body.requestKey)
        this.activeVersion = false
        this.malformedQuoteReads = 1
        this.ticket = {
          ...this.ticket,
          concern: 'Steering wheel clunks over bumps.',
          updatedAt: SAVED_TIME,
          jobs: this.ticket.jobs.map((item) => ({ ...item, approvalState: 'pending_quote' })),
          activities: [{
            id: ACTIVITY, jobId: null, kind: 'ticket_corrected', actorName: 'Avery Advisor',
            summary: 'Concern corrected.', correctionScope: 'concern', createdAt: SAVED_TIME,
          }],
        }
        this.record({
          method, path, outcome: 'late-success-before-malformed-refresh',
          body, requestKey: String(body.requestKey),
        })
        await this.savedCorrectionResponse.hold()
        await route.fulfill({
          status: 200,
          json: {
            outcome: 'changed', changed: true, scope: 'concern',
            invalidatedVersionNumber: 1, ticket: this.ticket,
          },
        })
        return
      }
      if (this.correctionPosts === 3) {
        expect(body).toEqual({
          action: 'concern',
          requestKey: this.savedCorrectionKey,
          expectedTicketUpdatedAt: STALE_TIME,
          expectedActiveVersionId: VERSION,
          concern: 'Steering wheel clunks over bumps.',
        })
        this.completedVisualSaves += 1
        this.record({
          method, path, outcome: 'single-completed-visual-save',
          body, requestKey: String(body.requestKey),
        })
        await route.fulfill({
          status: 200,
          json: {
            outcome: 'replayed', changed: false, scope: 'concern',
            invalidatedVersionNumber: 1, ticket: this.ticket,
          },
        })
        return
      }
    }

    const label = `${method} ${path}`
    this.unhandled.push(label)
    this.record({ method, path, outcome: 'refused-unhandled-loopback-api' })
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  }

  releaseAll(): void {
    this.savedCorrectionResponse.release()
  }
}

async function installNetworkBoundary(context: BrowserContext, page: Page) {
  const disallowed: string[] = []
  const sockets: string[] = []
  await page.exposeFunction('__recordBlockedTicketCorrectionSocket', (rawUrl: string) => {
    const url = new URL(rawUrl)
    sockets.push(`${url.origin}${url.pathname}`)
  })
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    window.WebSocket = class LoopbackOnlyWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const parsed = new URL(String(url), window.location.href)
        if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '4181') {
          void (window as unknown as {
            __recordBlockedTicketCorrectionSocket: (value: string) => Promise<void>
          }).__recordBlockedTicketCorrectionSocket(parsed.href)
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
    if (!socket.url().startsWith('ws://127.0.0.1:4181/')) {
      const blocked = new URL(socket.url())
      sockets.push(`${blocked.origin}${blocked.pathname}`)
    }
  })
  return { disallowed, sockets }
}

async function expectTargetAtLeast44(
  page: Page,
  role: 'button' | 'option',
  locatorName: string,
): Promise<void> {
  const target = page.getByRole(role, { name: locatorName, exact: true })
  const box = await target.boundingBox()
  expect(box, `${locatorName} has a rendered box`).not.toBeNull()
  expect(box!.height, `${locatorName} is at least 44px high`).toBeGreaterThanOrEqual(44)
  expect(box!.width, `${locatorName} is at least 44px wide`).toBeGreaterThanOrEqual(44)
}

async function expectVisibleInteractiveTargetsAtLeast44(page: Page, label: string): Promise<void> {
  // This journey has no inline-link exception: every mounted, rendered, enabled
  // interactive element is part of the scan, including content below the viewport.
  const targets = await page.locator([
    'a[href]',
    'button:enabled',
    'input:enabled:not([type="hidden"])',
    'select:enabled',
    'textarea:enabled',
    'summary',
    '[role="button"]:not([aria-disabled="true"])',
    '[role="option"]:not(:disabled):not([aria-disabled="true"])',
  ].join(',')).evaluateAll((elements) => elements.flatMap((element) => {
    const html = element as HTMLElement
    const style = getComputedStyle(html)
    const rect = html.getBoundingClientRect()
    if (style.display === 'none' || style.visibility === 'hidden'
      || rect.width === 0 || rect.height === 0) return []
    return [{
      tag: html.tagName.toLowerCase(),
      name: html.getAttribute('aria-label')
        ?? html.textContent?.replace(/\s+/g, ' ').trim()
        ?? html.getAttribute('name')
        ?? '(unnamed)',
      width: rect.width,
      height: rect.height,
    }]
  }))
  const undersized = targets.filter((target) => target.width < 44 || target.height < 44)
  expect(undersized, `${label} has no visible enabled interactive target below 44px`).toEqual([])
}

async function expectVisibleFocusOutline(locator: ReturnType<Page['locator']>): Promise<void> {
  const outline = await locator.evaluate((element) => {
    const style = getComputedStyle(element)
    return {
      color: style.outlineColor,
      style: style.outlineStyle,
      width: Number.parseFloat(style.outlineWidth),
    }
  })
  expect(outline.style).not.toBe('none')
  expect(outline.width).toBeGreaterThanOrEqual(2)
  expect(outline.color).not.toBe('transparent')
}

function normalizedTransitionLedger(entries: LedgerEntry[]): Array<LedgerEntry | {
  epoch: NonNullable<LedgerEntry['epoch']>
  entries: LedgerEntry[]
}> {
  const normalized: Array<LedgerEntry | {
    epoch: NonNullable<LedgerEntry['epoch']>
    entries: LedgerEntry[]
  }> = []
  for (let index = 0; index < entries.length;) {
    const entry = entries[index]
    if (!entry.epoch) {
      normalized.push(entry)
      index += 1
      continue
    }
    const epoch = entry.epoch
    const epochEntries: LedgerEntry[] = []
    while (entries[index]?.epoch === epoch) {
      const { epoch: _epoch, ...withoutEpoch } = entries[index]
      epochEntries.push(withoutEpoch)
      index += 1
    }
    normalized.push({
      epoch,
      entries: epochEntries.sort((left, right) => left.path.localeCompare(right.path)),
    })
  }
  return normalized
}

test('real mounted WriteUp keeps transient intake search truthful through deterministic recovery', async ({ context, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-transient-search`)
  const network = await installNetworkBoundary(context, page)
  const fixture = new SearchFixture()
  await page.clock.install({ time: new Date(INITIAL_TIME) })
  await page.route('**/api/**', (route) => fixture.handle(route))

  try {
    await page.goto('/intake')
    await expect(page.locator('body')).toHaveAttribute(
      'data-proof-boundary',
      'deterministic-loopback-rendering-not-database-persistence',
    )

    const search = page.getByRole('combobox', {
      name: 'Search customers and vehicles',
      exact: true,
    })
    await search.fill('pending proof')
    await page.clock.runFor(150)
    await fixture.pendingResponse.armed
    await expect(page.getByRole('status', {
      name: 'Searching customers and vehicles',
      exact: true,
    })).toBeVisible()
    await expect(page.getByText('Create new customer with this info')).toHaveCount(0)
    await checkpoint(page, testInfo, `${testInfo.project.name}-search-pending`)
    await expectVisibleInteractiveTargetsAtLeast44(page, 'pending search')
    fixture.pendingResponse.release()
    await expect(page.getByText(/Nothing matches.*pending proof/i)).toBeVisible()

    await search.fill('slow proof')
    await page.clock.runFor(150)
    await fixture.slowResponse.armed
    await page.clock.runFor(5_000)
    await expect(page.getByText(/Still searching/)).toBeVisible()
    await expect(page.getByText('Create new customer with this info')).toHaveCount(0)
    await checkpoint(page, testInfo, `${testInfo.project.name}-search-slow`)
    await expectVisibleInteractiveTargetsAtLeast44(page, 'slow search')
    fixture.slowResponse.release()
    await expect(page.getByText(/Nothing matches.*slow proof/i)).toBeVisible()

    await search.fill('error proof')
    await page.clock.runFor(150)
    await expect(page.getByText('Search unavailable')).toBeVisible()
    await expect(page.getByText('Create new customer with this info')).toHaveCount(0)
    await expectTargetAtLeast44(page, 'option', 'Retry search')
    await checkpoint(page, testInfo, `${testInfo.project.name}-search-error`)
    await expectVisibleInteractiveTargetsAtLeast44(page, 'search error')

    await page.getByRole('option', { name: 'Retry search', exact: true }).click()
    await fixture.retryResponse.armed
    fixture.retryResponse.release()
    await expect(page.getByText(/Nothing matches.*error proof/i)).toBeVisible()
    await expect(page.getByText('Create new customer with this info')).toBeVisible()
    await checkpoint(page, testInfo, `${testInfo.project.name}-search-recovered-no-match`)
    await expectVisibleInteractiveTargetsAtLeast44(page, 'recovered authoritative no-match')

    expect(fixture.unhandled, 'all loopback API calls are explicitly handled').toEqual([])
    expect(network.disallowed, 'no external HTTP(S) request was attempted').toEqual([])
    expect(network.sockets, 'no non-loopback WebSocket was attempted').toEqual([])
    expect(fixture.ledger).toEqual([
      {
        method: 'POST', path: '/api/intake/search',
        outcome: 'pending-then-authoritative-no-match', body: { q: 'pending proof' },
      },
      {
        method: 'POST', path: '/api/intake/search',
        outcome: 'slow-then-authoritative-no-match', body: { q: 'slow proof' },
      },
      {
        method: 'POST', path: '/api/intake/search',
        outcome: 'explicit-outage', body: { q: 'error proof' },
      },
      {
        method: 'POST', path: '/api/intake/search',
        outcome: 'retry-authoritative-no-match', body: { q: 'error proof' },
      },
    ])
    expect(faults.pageErrors, 'no uncaught browser errors').toEqual([])
    expect(faults.failedRequests, 'no failed browser requests').toEqual([])
    await expect.poll(() => faults.consoleErrors).toHaveLength(1)
    expect(faults.consoleErrors[0]).toMatch(
      /^Failed to load resource: the server responded with a status of 503(?: \(Service Unavailable\))?$/,
    )
  } finally {
    fixture.releaseAll()
    await page.unrouteAll({ behavior: 'wait' })
  }
})

test('real mounted WriteUp and TicketDetail finish, correct, and recover without intake search', async ({ context, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const faults = watchBrowserFaults(page, testInfo.project.name)
  const network = await installNetworkBoundary(context, page)
  const fixture = new FinishCorrectionFixture()
  await page.route('**/api/**', (route) => fixture.handle(route))

  try {
    await page.goto('/intake')
    await expect(page.locator('body')).toHaveAttribute(
      'data-proof-boundary',
      'deterministic-loopback-rendering-not-database-persistence',
    )

  await page.getByLabel('Name').fill('Marisol Vega')
  await page.getByLabel('Phone').fill('214-555-0197')
  await page.getByLabel('Year').fill('2019')
  await page.getByLabel('Make').fill('Ford')
  await page.getByLabel('Model').fill('F-150')
  await page.getByLabel('What brought them in?').fill('Steering wheel shakes under braking.')
  await page.getByRole('button', { name: /Find the cause/ }).click()
  await page.getByLabel('Description').fill('Diagnose brake vibration')
  await page.getByLabel('Hours').fill('1.25')
  await page.getByLabel('Price (USD)').fill('187.50')
  await page.getByRole('button', { name: 'Create repair order' }).first().click()

  await expect(page).toHaveURL(new RegExp(`/tickets/${TICKET}$`))
  await expect(page.getByRole('heading', { name: 'Marisol Vega' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Diagnose brake vibration' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Replace front brake pads' })).toBeVisible()
  await expect(page.getByText('2 jobs')).toBeVisible()
  await expect(page.getByText('Priced')).toHaveCount(2)
  await checkpoint(page, testInfo, `${testInfo.project.name}-finish`)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'post-create repair order')

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Replace front brake pads' })).toBeVisible()
  expect(fixture.counterPosts).toBe(1)

  const correct = page.getByRole('button', { name: 'Correct concern' })
  await expectTargetAtLeast44(page, 'button', 'Correct concern')
  await correct.focus()
  await correct.click()
  await expect(page.getByText('Checking current repair-order truth…')).toBeVisible()
  const correctedConcern = page.getByLabel('Corrected concern')
  await expect(correctedConcern).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(correctedConcern).toBeFocused()
  await correctedConcern.fill('Steering wheel clunks over bumps.')
  await expectTargetAtLeast44(page, 'button', 'Save correction')
  await page.getByRole('button', { name: 'Save correction' }).click()

  const retry = page.getByRole('button', { name: 'Retry correction' })
  await expect(retry).toBeFocused()
  await expect(correctedConcern).toHaveValue('Steering wheel clunks over bumps.')
  await expect(page.getByText('Current repair-order value: Shop truth changed while editing.')).toBeVisible()
  await expectTargetAtLeast44(page, 'button', 'Retry correction')
  await checkpoint(page, testInfo, `${testInfo.project.name}-stale-recovery-editor`)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'stale correction recovery editor')
  await retry.click()
  await fixture.savedCorrectionResponse.armed
  fixture.savedCorrectionResponse.release()

  await expect(page.getByText(
    'The correction may be saved, but current quote truth could not be checked. Retry here before leaving.',
  )).toBeVisible()
  const replayRetry = page.getByRole('button', { name: 'Retry correction' })
  await expect(replayRetry).toBeFocused()
  await checkpoint(page, testInfo, `${testInfo.project.name}-malformed-quote-recovery-editor`)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'malformed quote recovery editor')
  await replayRetry.click()

  const target = page.locator('[data-correction-target="concern"]')
  await expect(target).toBeFocused()
  await expect(target).toHaveAccessibleName('Concern correction target')
  await expect(target).toHaveAttribute('data-correction-state', 'confirmed')
  await expect(page.getByText('Already saved. The repair order is current.')).toBeVisible()
  await expect(page.getByText('Current draft · V1 no longer current')).toBeVisible()
  await expect(page.getByTestId('correction-signal-rail')).toBeVisible()
  await expect(target).toHaveCSS(
    'animation-name',
    /^_correction-detent_[a-z0-9]+_\d+$/,
  )
  await expect(target).toHaveCSS('animation-duration', '0.2s')
  await expect(target).toHaveCSS('opacity', '1')
  await expect.poll(() => target.evaluate((element) => {
    const transform = getComputedStyle(element).transform
    const matrix = transform === 'none'
      ? new DOMMatrixReadOnly()
      : new DOMMatrixReadOnly(transform)
    return { x: matrix.m41, y: matrix.m42 }
  })).toEqual({ x: 0, y: 0 })
  await expectVisibleFocusOutline(target)
  await expect(page.locator('[data-confetti], [data-toast-success], .success')).toHaveCount(0)
  await checkpoint(page, testInfo, `${testInfo.project.name}-correct-normal-motion`)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'normal-motion correction settle')

  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(target).toHaveCSS('animation-name', 'none')
  await expect(target).toHaveCSS('opacity', '1')
  await expect(target).toHaveCSS('transform', 'none')
  await expect(target).toBeFocused()
  await expectVisibleFocusOutline(target)
  await expect(page.getByTestId('correction-signal-rail')).toBeVisible()
  await expect(page.getByText('Already saved. The repair order is current.')).toBeVisible()
  await expect(page.getByText('Current draft · V1 no longer current')).toBeVisible()
  await checkpoint(page, testInfo, `${testInfo.project.name}-correct-reduced-motion`)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'reduced-motion correction settle')

  await page.evaluate(() => {
    window.history.pushState(null, '', '/intake?history-marker=1')
    window.dispatchEvent(new PopStateEvent('popstate'))
  })
  await expect(page.getByRole('heading', { name: "Who's the customer?" })).toBeVisible()
  await page.goBack()
  await expect(page.getByRole('heading', { name: 'Steering wheel clunks over bumps.' })).toBeVisible()
  await expect(page.getByText('2 jobs')).toBeVisible()
  await expect(page.locator('[data-correction-target="identity"]'))
    .toHaveAccessibleName('Customer and vehicle correction target')
  await expect(page.locator(`[data-correction-target="job:${DIAGNOSTIC}"]`))
    .toHaveAccessibleName('Job correction target 01')
  expect(fixture.correctionPosts).toBe(3)
  expect(fixture.completedVisualSaves).toBe(1)
  expect(fixture.unseenCountReads).toBe(3)
  expect(fixture.whatsNewLedger).toEqual([
    { method: 'GET', path: '/api/whats-new/unseen-count', outcome: 'current-zero-unseen-count' },
    { method: 'GET', path: '/api/whats-new/unseen-count', outcome: 'current-zero-unseen-count' },
    { method: 'GET', path: '/api/whats-new/unseen-count', outcome: 'current-zero-unseen-count' },
  ])

  await mkdir(resolve(process.cwd(), 'test-results/ticket-building-correction'), { recursive: true })
  const screenshot = testInfo.project.name.includes('phone') ? 'phone.png' : 'desktop.png'
  await page.screenshot({
    path: resolve(process.cwd(), 'test-results/ticket-building-correction', screenshot),
  })
  await checkpoint(page, testInfo, `${testInfo.project.name}-recover`)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'browser Back recovery')

  expect(fixture.unhandled, 'all loopback API calls are explicitly handled').toEqual([])
  expect(network.disallowed, 'no external HTTP(S) request was attempted').toEqual([])
  expect(network.sockets, 'no non-loopback WebSocket was attempted').toEqual([])
  expect(fixture.ledger.filter((entry) => entry.path === '/api/intake/search')).toEqual([])
  expect(fixture.ledger.filter((entry) => (
    entry.outcome === 'single-created-repair-order-and-install-resulting-two-job-state'
  ))).toHaveLength(1)
  expect(fixture.ledger.filter((entry) => entry.outcome === 'single-completed-visual-save')).toHaveLength(1)
  expect(fixture.counterRequestKey).not.toBeNull()
  expect(fixture.correctionRequestKeys).toHaveLength(3)
  expect(fixture.correctionRequestKeys[0]).not.toBe(fixture.correctionRequestKeys[1])
  expect(fixture.correctionRequestKeys[1]).toBe(fixture.correctionRequestKeys[2])
  expect(new Set([
    fixture.counterRequestKey,
    fixture.correctionRequestKeys[0],
    fixture.correctionRequestKeys[1],
  ]).size).toBe(3)

  const counterBody = {
    clientKey: fixture.counterRequestKey,
    vehicleMode: 'new',
    customer: { name: 'Marisol Vega', phone: '214-555-0197', email: null },
    vehicle: {
      year: 2019, make: 'Ford', model: 'F-150', engine: null,
      vin: null, mileage: null, plate: null,
    },
    concern: 'Steering wheel shakes under braking.',
    whenStarted: null,
    howOften: null,
    work: {
      mode: 'diagnosis-manual', description: 'Diagnose brake vibration',
      laborHours: 1.25, priceCents: 18_750,
    },
    assignedTechId: null,
  }
  const correctionBody = (requestKey: string, expectedTicketUpdatedAt: string) => ({
    action: 'concern', requestKey, expectedTicketUpdatedAt,
    expectedActiveVersionId: VERSION,
    concern: 'Steering wheel clunks over bumps.',
  })
  expect(normalizedTransitionLedger(fixture.ledger)).toEqual([
    {
      method: 'POST', path: '/api/tickets/counter',
      outcome: 'single-created-repair-order-and-install-resulting-two-job-state',
      body: counterBody, requestKey: fixture.counterRequestKey,
    },
    { method: 'GET', path: `/api/tickets/${TICKET}`, outcome: 'current-deterministic-ticket' },
    { method: 'GET', path: `/api/tickets/${TICKET}`, outcome: 'current-deterministic-ticket' },
    {
      epoch: 'initial-correction-baseline',
      entries: [
        { method: 'GET', path: `/api/tickets/${TICKET}`, outcome: 'current-deterministic-ticket' },
        { method: 'GET', path: `/api/tickets/${TICKET}/quote`, outcome: 'current-deterministic-quote' },
      ],
    },
    {
      method: 'POST', path: `/api/tickets/${TICKET}/corrections`, outcome: 'stale-conflict',
      body: correctionBody(fixture.correctionRequestKeys[0], INITIAL_TIME),
      requestKey: fixture.correctionRequestKeys[0],
    },
    {
      epoch: 'conflict-refresh-baseline',
      entries: [
        { method: 'GET', path: `/api/tickets/${TICKET}`, outcome: 'current-deterministic-ticket' },
        { method: 'GET', path: `/api/tickets/${TICKET}/quote`, outcome: 'current-deterministic-quote' },
      ],
    },
    {
      method: 'POST', path: `/api/tickets/${TICKET}/corrections`,
      outcome: 'late-success-before-malformed-refresh',
      body: correctionBody(fixture.correctionRequestKeys[1], STALE_TIME),
      requestKey: fixture.correctionRequestKeys[1],
    },
    { method: 'GET', path: `/api/tickets/${TICKET}/quote`, outcome: 'malformed-refresh-refused' },
    {
      method: 'POST', path: `/api/tickets/${TICKET}/corrections`,
      outcome: 'single-completed-visual-save',
      body: correctionBody(fixture.correctionRequestKeys[2], STALE_TIME),
      requestKey: fixture.correctionRequestKeys[2],
    },
    { method: 'GET', path: `/api/tickets/${TICKET}/quote`, outcome: 'current-deterministic-quote' },
    { method: 'GET', path: `/api/tickets/${TICKET}`, outcome: 'current-deterministic-ticket' },
  ])
  assertNoBrowserFaults([faults])
  } finally {
    fixture.releaseAll()
    await page.unrouteAll({ behavior: 'wait' })
  }
})
