import { expect, test, type BrowserContext, type Page, type Route } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseQuoteBuilderProjection } from '@/lib/shop-os/quote-builder-ui'
import {
  assertNoBrowserFaults,
  checkpoint,
  watchBrowserFaults,
} from './golden-browser-receipts'

const ORIGIN = 'http://127.0.0.1:4182'
const TICKET = '00000000-0000-4000-8000-000000000101'
const JOB = '00000000-0000-4000-8000-000000000201'
const PART = '00000000-0000-4000-8000-000000000301'
const LABOR = '00000000-0000-4000-8000-000000000302'
const FEE = '00000000-0000-4000-8000-000000000303'
const VERSION_1 = '00000000-0000-4000-8000-000000000401'
const VERSION_2 = '00000000-0000-4000-8000-000000000402'

type ManualLine = {
  id: string
  kind: 'part' | 'labor' | 'fee'
  description: string
  sort: number
  quantity: string
  priceCents: number
  taxable: boolean
  partNumber: string | null
  brand: string | null
  coreChargeCents: number | null
  fitment: string | null
  laborHours: string | null
  laborRateCents: number | null
  source: 'manual'
  mutable: true
  lineFingerprint: string
}

type LedgerEntry = {
  method: string
  path: string
  outcome: string
  body?: unknown
}

const token = (character: string) => character.repeat(64)
const hexToken = (index: number) => token('0123456789abcdef'[index % 16])

function total(lines: ManualLine[]) {
  const subtotalCents = lines.reduce((sum, line) => sum + line.priceCents, 0)
  const taxableSubtotalCents = lines.reduce(
    (sum, line) => sum + (line.taxable ? line.priceCents : 0),
    0,
  )
  const taxCents = Math.round((taxableSubtotalCents * 825) / 10_000)
  return { subtotalCents, taxableSubtotalCents, taxCents, totalCents: subtotalCents + taxCents }
}

function lineFromBody(id: string, fingerprint: string, body: Record<string, unknown>): ManualLine {
  const kind = body.kind as ManualLine['kind']
  return {
    id,
    kind,
    description: String(body.description),
    sort: Number(body.sort ?? (kind === 'part' ? 10 : kind === 'labor' ? 20 : 30)),
    quantity: String(body.quantity ?? '1'),
    priceCents: Number(body.priceCents),
    taxable: body.taxable === true,
    partNumber: typeof body.partNumber === 'string' ? body.partNumber : null,
    brand: typeof body.brand === 'string' ? body.brand : null,
    coreChargeCents: typeof body.coreChargeCents === 'number' ? body.coreChargeCents : null,
    fitment: typeof body.fitment === 'string' ? body.fitment : null,
    laborHours: typeof body.laborHours === 'string' ? body.laborHours : null,
    laborRateCents: typeof body.laborRateCents === 'number' ? body.laborRateCents : null,
    source: 'manual',
    mutable: true,
    lineFingerprint: fingerprint,
  }
}

class QuoteFixture {
  readonly ledger: LedgerEntry[] = []
  readonly unhandled: string[] = []
  readonly createKeys: string[] = []
  readonly journey: 'finish-correct' | 'recover'
  lines: ManualLine[] = []
  activeVersion: { id: string; versionNumber: number; fingerprint: string; totalCents: number } | null = null
  lastPrepared: { id: string; versionNumber: number; fingerprint: string; totalCents: number; state: 'current' | 'superseded' } | null = null
  draftFingerprint = token('a')
  createAttempts = 0
  lineRevision = 0
  versionPosts = 0
  editPosts = 0
  deletePosts = 0
  lateRefreshFailures = 0

  constructor(journey: 'finish-correct' | 'recover') {
    this.journey = journey
  }

  project() {
    const totals = total(this.lines)
    return {
      ticket: { id: TICKET, status: 'open', reconciled: true },
      configuration: {
        laborRateCents: 15_000,
        taxRateBps: 825,
        partsMarkupBps: null,
        laborRateConfigured: true,
        taxRateConfigured: true,
      },
      jobs: [{
        id: JOB,
        title: 'Replace front brakes',
        kind: 'repair',
        workStatus: 'open',
        customerSuppliedPartsNote: null,
        story: { content: null, source: null, reviewStatus: null, revision: 0 },
        storyMode: null,
        decisionEligible: false,
        approval: {
          state: this.activeVersion ? 'quote_ready' : 'pending_quote',
          quoteVersionId: null,
        },
        lines: this.lines,
      }],
      capabilities: { canRecordCustomerApproval: true },
      activeVersion: this.activeVersion ? {
        id: this.activeVersion.id,
        versionNumber: this.activeVersion.versionNumber,
        totalCents: this.activeVersion.totalCents,
        contentFingerprint: this.activeVersion.fingerprint,
        jobs: [{ jobId: JOB, subtotalCents: this.activeVersion.totalCents - Math.round(
          (this.lines.filter((line) => line.taxable).reduce((sum, line) => sum + line.priceCents, 0) * 825) / 10_000,
        ) }],
      } : null,
      lastPreparedVersion: this.lastPrepared ? {
        id: this.lastPrepared.id,
        versionNumber: this.lastPrepared.versionNumber,
        totalCents: this.lastPrepared.totalCents,
        contentFingerprint: this.lastPrepared.fingerprint,
        state: this.lastPrepared.state,
      } : null,
      draftCommitment: !this.activeVersion && this.lines.length > 0 ? {
        algorithm: 'quote-draft-v1-sha256',
        fingerprint: this.draftFingerprint,
        totalCents: totals.totalCents,
        jobCount: 1,
        lineCount: this.lines.length,
      } : null,
    }
  }

  rotateDraft(): void {
    this.draftFingerprint = hexToken(10 + this.lineRevision)
  }

  addLine(rawBody: Record<string, unknown>): ManualLine {
    const body = rawBody.line as Record<string, unknown>
    const id = body.kind === 'part' ? PART : body.kind === 'labor' ? LABOR : FEE
    const fingerprint = hexToken(1 + this.lineRevision)
    const line = lineFromBody(id, fingerprint, body)
    this.lines = [...this.lines.filter((candidate) => candidate.id !== id), line]
    this.lineRevision += 1
    this.rotateDraft()
    return line
  }

  supersedeActive(): void {
    if (!this.activeVersion) return
    this.lastPrepared = { ...this.activeVersion, state: 'superseded' }
    this.activeVersion = null
  }

  async handle(route: Route): Promise<void> {
    const request = route.request()
    const method = request.method()
    const path = new URL(request.url()).pathname
    const body = method === 'GET' ? undefined : request.postDataJSON() as Record<string, unknown>

    if (method === 'GET' && path === `/api/tickets/${TICKET}/quote`) {
      if (this.lateRefreshFailures > 0) {
        this.lateRefreshFailures -= 1
        this.ledger.push({ method, path, outcome: 'explicit-refresh-failure' })
        await route.fulfill({ status: 503, json: { error: 'unavailable' } })
        return
      }
      const projection = this.project()
      expect(
        parseQuoteBuilderProjection(projection),
        `fixture must mirror a complete server projection: ${JSON.stringify(projection)}`,
      ).not.toBeNull()
      this.ledger.push({ method, path, outcome: 'current-projection' })
      await route.fulfill({ status: 200, json: { builder: projection } })
      return
    }

    if (method === 'POST' && path === `/api/tickets/${TICKET}/quote/jobs/${JOB}/lines`) {
      this.createAttempts += 1
      this.createKeys.push(String(body?.clientKey))
      if (this.journey === 'recover' && this.createAttempts === 1) {
        this.ledger.push({ method, path, outcome: 'interrupted-create', body })
        await route.fulfill({ status: 503, json: { error: 'unavailable' } })
        return
      }
      const line = this.addLine(body ?? {})
      this.ledger.push({ method, path, outcome: 'one-durable-line', body })
      await route.fulfill({ status: 201, json: { changed: true, line: { id: line.id } } })
      return
    }

    if (method === 'PUT' && path === `/api/tickets/${TICKET}/quote/jobs/${JOB}/lines/${PART}`) {
      this.editPosts += 1
      const existing = this.lines.find((line) => line.id === PART)
      if (!existing) throw new Error('part edit reached fixture without a line')
      if (this.journey === 'recover' && this.editPosts === 1) {
        this.lines = this.lines.map((line) => line.id === PART
          ? { ...line, description: 'Server-edited pads', lineFingerprint: hexToken(12) }
          : line)
        this.lineRevision += 1
        this.rotateDraft()
        this.ledger.push({ method, path, outcome: 'stale-line-edit', body })
        await route.fulfill({ status: 409, json: { error: 'conflict', retryable: false } })
        return
      }
      expect(body?.expectedLineFingerprint).toBe(existing.lineFingerprint)
      const replacement = lineFromBody(PART, hexToken(4 + this.editPosts), body?.line as Record<string, unknown>)
      this.lines = this.lines.map((line) => line.id === PART ? replacement : line)
      this.supersedeActive()
      this.lineRevision += 1
      this.rotateDraft()
      this.ledger.push({ method, path, outcome: 'durable-line-correction', body })
      await route.fulfill({ status: 200, json: { changed: true, line: { id: PART } } })
      return
    }

    if (method === 'DELETE' && path === `/api/tickets/${TICKET}/quote/jobs/${JOB}/lines/${PART}`) {
      this.deletePosts += 1
      const existing = this.lines.find((line) => line.id === PART)
      if (!existing) throw new Error('part removal reached fixture without a line')
      if (this.journey === 'recover' && this.deletePosts === 1) {
        this.lines = this.lines.map((line) => line.id === PART
          ? { ...line, description: 'Server-retained pads', lineFingerprint: hexToken(13) }
          : line)
        this.lineRevision += 1
        this.rotateDraft()
        this.ledger.push({ method, path, outcome: 'stale-line-remove', body })
        await route.fulfill({ status: 409, json: { error: 'conflict', retryable: false } })
        return
      }
      expect(body?.expectedLineFingerprint).toBe(existing.lineFingerprint)
      this.lines = this.lines.filter((line) => line.id !== PART)
      this.lineRevision += 1
      this.rotateDraft()
      this.ledger.push({ method, path, outcome: 'durable-line-remove', body })
      await route.fulfill({ status: 200, json: { changed: true } })
      return
    }

    if (method === 'POST' && path === `/api/tickets/${TICKET}/quote/versions`) {
      this.versionPosts += 1
      if (this.journey === 'recover' && this.versionPosts === 1) {
        const line = this.lines[0]
        this.lines = [{ ...line, priceCents: line.priceCents + 100, lineFingerprint: hexToken(14) }]
        this.lineRevision += 1
        this.rotateDraft()
        this.ledger.push({ method, path, outcome: 'stale-prepare', body })
        await route.fulfill({ status: 409, json: { error: 'conflict', retryable: false } })
        return
      }
      expect(body?.expectedDraftFingerprint).toBe(this.draftFingerprint)
      const versionNumber = this.journey === 'finish-correct' ? this.versionPosts : 1
      const versionId = versionNumber === 1 ? VERSION_1 : VERSION_2
      const currentTotal = total(this.lines).totalCents
      this.activeVersion = {
        id: versionId,
        versionNumber,
        fingerprint: this.draftFingerprint,
        totalCents: currentTotal,
      }
      this.lastPrepared = { ...this.activeVersion, state: 'current' }
      if (this.journey === 'recover') {
        this.lateRefreshFailures = 1
        this.ledger.push({ method, path, outcome: 'late-success-malformed-envelope', body })
        await route.fulfill({
          status: 201,
          json: { changed: true, version: { id: versionId, versionNumber }, extra: true },
        })
        return
      }
      this.ledger.push({ method, path, outcome: `prepared-v${versionNumber}`, body })
      await route.fulfill({
        status: 201,
        json: { changed: true, version: { id: versionId, versionNumber } },
      })
      return
    }

    const label = `${method} ${path}`
    this.unhandled.push(label)
    this.ledger.push({ method, path, outcome: 'refused-unhandled-loopback-api', body })
    await route.fulfill({ status: 599, json: { error: 'unhandled_fixture_call' } })
  }
}

async function installNetworkBoundary(context: BrowserContext, page: Page) {
  const disallowed: string[] = []
  const sockets: string[] = []
  await page.exposeFunction('__recordBlockedQuoteCommitmentSocket', (rawUrl: string) => {
    const url = new URL(rawUrl)
    sockets.push(`${url.origin}${url.pathname}`)
  })
  await page.addInitScript(() => {
    const NativeWebSocket = window.WebSocket
    window.WebSocket = class LoopbackOnlyWebSocket extends NativeWebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        const parsed = new URL(String(url), window.location.href)
        if (parsed.protocol !== 'ws:' || parsed.hostname !== '127.0.0.1' || parsed.port !== '4182') {
          void (window as unknown as {
            __recordBlockedQuoteCommitmentSocket: (value: string) => Promise<void>
          }).__recordBlockedQuoteCommitmentSocket(parsed.href)
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
    if (!socket.url().startsWith('ws://127.0.0.1:4182/')) {
      const blocked = new URL(socket.url())
      sockets.push(`${blocked.origin}${blocked.pathname}`)
    }
  })
  return { disallowed, sockets }
}

async function expectVisibleInteractiveTargetsAtLeast44(page: Page, label: string): Promise<void> {
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
    targets.filter((target) => target.width < 44 || target.height < 44),
    `${label} has no visible enabled interactive target below 44px`,
  ).toEqual([])
}

async function expectEditorNotOccluded(page: Page): Promise<void> {
  const tape = page.getByRole('complementary', { name: 'Quote totals' })
  const save = page.getByRole('button', { name: 'Save line' })
  await expect(tape).toHaveAttribute('data-rail-static', 'true')
  const geometry = await page.evaluate(() => {
    const rail = document.querySelector<HTMLElement>('[aria-label="Quote totals"]')!
    const button = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
      .find((candidate) => candidate.textContent === 'Save line')!
    const left = rail.getBoundingClientRect()
    const right = button.getBoundingClientRect()
    return {
      position: getComputedStyle(rail).position,
      overlaps: !(left.right <= right.left || left.left >= right.right
        || left.bottom <= right.top || left.top >= right.bottom),
    }
  })
  expect(geometry.position).not.toBe('fixed')
  expect(geometry.overlaps).toBe(false)
  await expect(save).toBeVisible()
  const editorTargets = await page.getByRole('form', { name: /(?:Add|Edit) (?:part|labor|fee) line/ })
    .locator('input:not([type="checkbox"]), button:enabled')
    .evaluateAll((elements) => elements.map((element) => {
      const rect = (element as HTMLElement).getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    }))
  expect(editorTargets.every((target) => target.width >= 44 && target.height >= 44)).toBe(true)
}

async function addLine(page: Page, kind: 'part' | 'labor' | 'fee', values: {
  description: string
  price?: string
  hours?: string
  rate?: string
}): Promise<void> {
  await page.getByRole('button', { name: `Add ${kind}` }).click()
  await page.getByLabel('Description', { exact: true }).fill(values.description)
  if (values.price) await page.getByLabel('Line price').fill(values.price)
  if (values.hours) await page.getByLabel('Hours', { exact: true }).fill(values.hours)
  if (values.rate) await page.getByLabel('Rate per hour').fill(values.rate)
  await expectEditorNotOccluded(page)
  await page.getByRole('button', { name: 'Save line' }).click()
}

async function preserveScreenshot(page: Page, projectName: string, journey: string): Promise<void> {
  const directory = resolve(process.cwd(), 'test-results/quote-composition-commitment')
  await mkdir(directory, { recursive: true })
  await page.screenshot({ path: resolve(directory, `${projectName}-${journey}.png`) })
}

test('real Quote Bench finishes, corrects, and prepares exact V1/V2 truth', async ({ context, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-finish-correct`)
  const network = await installNetworkBoundary(context, page)
  const fixture = new QuoteFixture('finish-correct')
  await page.route('**/api/**', (route) => fixture.handle(route))

  await page.goto('/finish-correct')
  await expect(page.locator('body')).toHaveAttribute(
    'data-proof-boundary',
    'deterministic-loopback-rendering-not-database-persistence',
  )
  await expect(page.getByRole('heading', { name: 'Current draft' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Prepare quote' })).toHaveCount(0)

  await addLine(page, 'part', { description: 'Front pad set', price: '120.00' })
  await addLine(page, 'labor', { description: 'Brake labor', hours: '1.25', rate: '150.00' })
  await addLine(page, 'fee', { description: 'Shop supplies', price: '5.00' })
  await expect(page.getByText('$322.81').first()).toBeVisible()

  const beforePrepare = fixture.ledger.length
  await page.getByRole('button', { name: 'Prepare quote' }).click()
  expect(fixture.ledger).toHaveLength(beforePrepare)
  await expect(page.getByRole('heading', { name: 'Prepare this exact quote?' })).toBeFocused()
  await expect(page.getByText('Customer will see $322.81')).toBeVisible()
  await expectVisibleInteractiveTargetsAtLeast44(page, 'V1 commitment plate')
  await page.getByRole('button', { name: 'Prepare $322.81' }).click()
  await expect(page.getByRole('heading', { name: 'Prepared V1' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Authorization for Replace front brakes' })).toBeFocused()

  await page.getByRole('button', { name: 'Edit Front pad set' }).click()
  await page.getByLabel('Description', { exact: true }).fill('Front pads and hardware')
  await expect(page.getByRole('heading', { name: 'Prepared V1 remains current' })).toBeVisible()
  await expect(page.getByText('Unsaved line changes')).toBeVisible()
  await expectEditorNotOccluded(page)
  await page.getByRole('button', { name: 'Save line' }).click()
  await expect(page.getByRole('heading', { name: 'Current draft' })).toBeVisible()
  await expect(page.getByText('V1 no longer current')).toBeVisible()
  await expect(page.getByText('Last prepared total').locator('..')).toContainText('$322.81')

  await page.getByRole('button', { name: 'Prepare quote' }).click()
  await expect(page.getByText('Customer will see $322.81')).toBeVisible()
  await expectVisibleInteractiveTargetsAtLeast44(page, 'V2 commitment plate')
  await page.getByRole('button', { name: 'Prepare $322.81' }).click()
  await expect(page.getByRole('heading', { name: 'Prepared V2' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Authorization for Replace front brakes' })).toBeFocused()
  const tape = page.getByRole('complementary', { name: 'Quote totals' })
  await expect(tape).toHaveAttribute('data-settled', 'true')
  await expect(tape).toHaveCSS('animation-duration', '0.2s')

  await checkpoint(page, testInfo, `${testInfo.project.name}-finish-correct-normal-motion`)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'finished and corrected quote')
  await preserveScreenshot(page, testInfo.project.name, 'finish-correct')
  const durableHeading = await tape.getByRole('heading').first().textContent()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(tape.getByRole('heading').first()).toHaveText(durableHeading ?? '')
  await expect(tape).toHaveCSS('animation-name', 'none')
  await checkpoint(page, testInfo, `${testInfo.project.name}-finish-correct-reduced-motion`)

  expect(fixture.unhandled).toEqual([])
  expect(network.disallowed).toEqual([])
  expect(network.sockets).toEqual([])
  expect(fixture.ledger.map(({ method, outcome }) => `${method}:${outcome}`)).toEqual([
    'POST:one-durable-line', 'GET:current-projection',
    'POST:one-durable-line', 'GET:current-projection',
    'POST:one-durable-line', 'GET:current-projection',
    'POST:prepared-v1', 'GET:current-projection',
    'PUT:durable-line-correction', 'GET:current-projection',
    'POST:prepared-v2', 'GET:current-projection',
  ])
  assertNoBrowserFaults([faults])
})

test('real Quote Bench recovers interrupted, stale, malformed, and late-success work explicitly', async ({ context, page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  const faults = watchBrowserFaults(page, `${testInfo.project.name}-recover`)
  const network = await installNetworkBoundary(context, page)
  const fixture = new QuoteFixture('recover')
  await page.route('**/api/**', (route) => fixture.handle(route))

  await page.goto('/recover')
  await page.getByRole('button', { name: 'Add part' }).click()
  await page.getByLabel('Description', { exact: true }).fill('Front pad set')
  await page.getByLabel('Line price').fill('120.00')
  await page.getByRole('button', { name: 'Save line' }).click()
  await expect(page.getByText('Review the visible fields, then refresh and retry.')).toBeVisible()
  await page.getByRole('button', { name: 'Save line' }).click()
  await expect(page.getByText('Front pad set', { exact: true })).toBeVisible()
  expect(fixture.createKeys).toHaveLength(2)
  expect(fixture.createKeys[0]).toBe(fixture.createKeys[1])
  expect(fixture.lines).toHaveLength(1)

  await page.getByRole('button', { name: 'Edit Front pad set' }).click()
  await page.getByLabel('Description', { exact: true }).fill('Locally edited pads')
  await page.getByRole('button', { name: 'Save line' }).click()
  await expect(page.getByText('This line changed elsewhere. Your typed changes are still here.')).toBeVisible()
  await expect(page.getByLabel('Description', { exact: true })).toHaveValue('Locally edited pads')
  await page.getByRole('button', { name: 'Save line' }).click()
  await expect(page.getByText('Locally edited pads', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Remove Locally edited pads' }).click()
  await expectVisibleInteractiveTargetsAtLeast44(page, 'line removal confirmation')
  await page.getByRole('button', { name: 'Confirm remove' }).click()
  await expect(page.getByText('This line changed elsewhere. Review the updated line before removing it.')).toBeVisible()
  await page.getByRole('button', { name: 'Remove Server-retained pads' }).click()
  await page.getByRole('button', { name: 'Confirm remove' }).click()
  await expect(page.getByText('No quote lines yet.')).toBeVisible()

  await addLine(page, 'fee', { description: 'Shop supplies', price: '5.00' })
  const staleTotal = total(fixture.lines).totalCents
  await page.getByRole('button', { name: 'Prepare quote' }).click()
  await expectVisibleInteractiveTargetsAtLeast44(page, 'stale commitment plate')
  await page.getByRole('button', { name: `Prepare $${(staleTotal / 100).toFixed(2)}` }).click()
  await expect(page.getByText('The quote changed elsewhere. Review the updated quote before preparing again.')).toBeVisible()
  await expect(page.getByRole('dialog', { name: 'Prepare this exact quote?' })).toHaveCount(0)

  const currentTotal = total(fixture.lines).totalCents
  await page.getByRole('button', { name: 'Prepare quote' }).click()
  await expectVisibleInteractiveTargetsAtLeast44(page, 'recovery commitment plate')
  await page.getByRole('button', { name: `Prepare $${(currentTotal / 100).toFixed(2)}` }).click()
  await expect(page.getByText('Review the visible fields, then refresh and retry.')).toBeVisible()
  await page.getByRole('button', { name: 'Refresh quote' }).click()
  await expect(page.getByRole('button', { name: 'Refresh quote' })).toBeVisible()
  await page.getByRole('button', { name: 'Refresh quote' }).click()
  await expect(page.getByRole('heading', { name: 'Prepared V1' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Prepared V1' })).toBeFocused()
  expect(fixture.versionPosts).toBe(2)

  const tape = page.getByRole('complementary', { name: 'Quote totals' })
  await expect(tape).not.toHaveAttribute('data-settled')
  await checkpoint(page, testInfo, `${testInfo.project.name}-recover-normal-motion`)
  await expectVisibleInteractiveTargetsAtLeast44(page, 'recovered quote')
  await preserveScreenshot(page, testInfo.project.name, 'recover')
  const durableHeading = await tape.getByRole('heading').first().textContent()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(tape.getByRole('heading').first()).toHaveText(durableHeading ?? '')
  await expect(tape).toHaveCSS('animation-name', 'none')
  await checkpoint(page, testInfo, `${testInfo.project.name}-recover-reduced-motion`)

  expect(fixture.unhandled).toEqual([])
  expect(network.disallowed).toEqual([])
  expect(network.sockets).toEqual([])
  expect(fixture.ledger.map(({ method, outcome }) => `${method}:${outcome}`)).toEqual([
    'POST:interrupted-create',
    'POST:one-durable-line', 'GET:current-projection',
    'PUT:stale-line-edit', 'GET:current-projection',
    'PUT:durable-line-correction', 'GET:current-projection',
    'DELETE:stale-line-remove', 'GET:current-projection',
    'DELETE:durable-line-remove', 'GET:current-projection',
    'POST:one-durable-line', 'GET:current-projection',
    'POST:stale-prepare', 'GET:current-projection',
    'POST:late-success-malformed-envelope',
    'GET:explicit-refresh-failure',
    'GET:current-projection',
  ])
  expect(fixture.ledger.filter((entry) => entry.outcome === 'late-success-malformed-envelope'))
    .toHaveLength(1)
  expect(faults.pageErrors, 'uncaught browser errors').toEqual([])
  expect(faults.failedRequests, 'failed browser requests').toEqual([])
  // Chrome logs deliberate non-2xx fetch responses as console errors. The
  // fixture ledger above binds these five entries to the interrupted create,
  // stale edit/remove/prepare, and explicit refresh failure in this journey.
  // Requiring the exact ordered list keeps every unplanned console error red.
  expect(faults.consoleErrors, 'only the journey\'s asserted refusals reached the console').toEqual([
    'Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
    'Failed to load resource: the server responded with a status of 409 (Conflict)',
    'Failed to load resource: the server responded with a status of 409 (Conflict)',
    'Failed to load resource: the server responded with a status of 409 (Conflict)',
    'Failed to load resource: the server responded with a status of 503 (Service Unavailable)',
  ])
})
