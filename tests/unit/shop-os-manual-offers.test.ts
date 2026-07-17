import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  captureManualOffer,
  removeManualOffer,
  type ManualOfferActor,
} from '@/lib/shop-os/parts-offers'
import {
  customers,
  jobLines,
  profiles,
  quoteVersions,
  shops,
  ticketJobs,
  tickets,
  vehicles,
  vendorAccounts,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS manual offer mutations', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let ticketId: string
  let jobId: string
  let accountId: string
  let actor: ManualOfferActor

  const body = (overrides: Record<string, unknown> = {}) => ({
    clientKey: uuid(100),
    vendorAccountId: accountId,
    description: 'Front brake pads',
    partNumber: 'PAD-1',
    brand: 'ACME',
    quantity: '2',
    priceCents: 18_000,
    unitCostCents: 5_000,
    coreChargeCents: 1_000,
    taxable: true,
    availability: 'in_stock',
    fitment: 'Front axle',
    fulfillment: { method: 'pickup', locationLabel: 'Main counter' },
    externalOfferId: 'phone-quote-7',
    ...overrides,
  })

  const capture = (
    overrides: Record<string, unknown> = {},
    inputOverrides = {},
    dependencies = {},
  ) => captureManualOffer(
    db,
    { actor, ticketId, jobId, body: body(overrides), ...inputOverrides },
    dependencies,
  )

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North Shop' },
      { name: 'South Shop' },
    ]).returning()
    shopId = shop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(11), shopId, role: 'tech' },
      { id: uuid(3), userId: uuid(13), shopId, role: 'advisor' },
      { id: uuid(2), userId: uuid(12), shopId: otherShop.id, role: 'owner' },
    ])
    actor = { profileId: uuid(1) }
    const [customer] = await db.insert(customers).values({
      id: uuid(20), shopId, name: 'Customer', phone: '555-0100',
    }).returning()
    const [vehicle] = await db.insert(vehicles).values({
      id: uuid(21), customerId: customer.id, year: 2018, make: 'Ford', model: 'F-250',
    }).returning()
    ticketId = uuid(30)
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 1, source: 'counter',
      customerId: customer.id, vehicleId: vehicle.id, concern: 'Brake noise',
      createdByProfileId: uuid(1),
    })
    jobId = uuid(40)
    await db.insert(ticketJobs).values([
      { id: jobId, shopId, ticketId, title: 'Front brakes', kind: 'repair', requiredSkillTier: 1 },
      { id: uuid(41), shopId, ticketId, title: 'Rear brakes', kind: 'maintenance', requiredSkillTier: 1 },
    ])
    accountId = uuid(50)
    await db.insert(vendorAccounts).values({
      id: accountId, shopId, vendor: 'manual', displayName: 'Local Parts', mode: 'manual',
      nonSecretConfig: {}, secretRef: null, enabled: true,
    })
  })

  afterEach(async () => close())

  it('captures a strict human-verified offer with server-owned identity, ordering, and private fingerprint', async () => {
    const result = await capture()
    expect(result).toMatchObject({
      ok: true,
      changed: true,
      line: {
        id: uuid(100), jobId, kind: 'part', description: 'Front brake pads', quantity: '2',
        priceCents: 18_000, taxable: true, partNumber: 'PAD-1', brand: 'ACME',
        fitment: 'Front axle', source: 'vendor_offer', mutable: false,
      },
      sourcing: {
        vendorAccountId: accountId, displayName: 'Local Parts', externalOfferId: 'phone-quote-7',
        unitCostCents: 5_000, coreChargeCents: 1_000, availability: 'in_stock',
        fulfillment: { method: 'pickup', locationLabel: 'Main counter' },
      },
    })
    const [stored] = await db.select().from(jobLines).where(eq(jobLines.id, uuid(100)))
    expect(stored).toMatchObject({ sort: 0, source: 'vendor_offer', partStatus: 'proposed' })
    expect(stored.orderedAt).toBeNull()
    expect(stored.orderedByProfileId).toBeNull()
    expect(stored.vendorSnapshot).toMatchObject({
      schemaVersion: 1, kind: 'manual_offer', currency: 'USD',
      verifiedByProfileId: uuid(1), requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('verifiedByProfileId')
    expect(serialized).not.toContain('requestFingerprint')
    expect(serialized).not.toContain('nonSecretConfig')
    expect(serialized).not.toContain('secretRef')
  })

  it('allocates sort from only the fully locked target lines and finalizes capture once', async () => {
    await db.insert(jobLines).values([
      {
        id: uuid(70), shopId, jobId, kind: 'fee', description: 'Target fee', sort: 5,
        priceCents: 100, taxable: false, source: 'manual',
      },
      {
        id: uuid(71), shopId, jobId: uuid(41), kind: 'fee', description: 'Sibling maximum',
        sort: 2_147_483_647, priceCents: 100, taxable: false, source: 'manual',
      },
    ])
    const [beforeTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [beforeJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))

    const result = await capture()

    expect(result).toMatchObject({ ok: true, changed: true })
    const [line] = await db.select().from(jobLines).where(eq(jobLines.id, uuid(100)))
    const [afterTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [afterJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(line.sort).toBe(6)
    expect(afterJob.revision).toBe(beforeJob.revision + 1n)
    expect(afterTicket.projectionRevision).toBe(beforeTicket.projectionRevision + 1n)
    expect(afterTicket.continuityRevision).toBe(beforeTicket.continuityRevision + 1n)
  })

  it('refuses target-line sort overflow without line or revision residue', async () => {
    await db.insert(jobLines).values({
      id: uuid(72), shopId, jobId, kind: 'fee', description: 'Target maximum',
      sort: 2_147_483_647, priceCents: 100, taxable: false, source: 'manual',
    })
    const [beforeTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [beforeJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))

    await expect(capture()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })

    const [afterTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [afterJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(afterJob.revision).toBe(beforeJob.revision)
    expect(afterTicket.projectionRevision).toBe(beforeTicket.projectionRevision)
    expect(afterTicket.continuityRevision).toBe(beforeTicket.continuityRevision)
    expect(await db.select().from(jobLines).where(eq(jobLines.id, uuid(100)))).toHaveLength(0)
  })

  it('authorizes before exact replay and replays before current account state or quote invalidation', async () => {
    const first = await capture()
    await db.update(vendorAccounts).set({ displayName: 'Renamed', enabled: false }).where(eq(vendorAccounts.id, accountId))
    const [version] = await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 1, snapshot: snapshot(), createdByProfileId: uuid(1),
    }).returning()
    await expect(capture()).resolves.toEqual({ ...first, changed: false })
    const [stillActive] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id))
    expect(stillActive.supersededAt).toBeNull()
    await expect(captureManualOffer(db, {
      actor: { profileId: uuid(3) }, ticketId, jobId, body: body(),
    })).resolves.toEqual({ ...first, changed: false })
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null }).where(eq(profiles.id, uuid(1)))
    await expect(capture()).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('conflicts on changed key reuse and rejects new capture through disabled, wrong-shop, or non-clean accounts', async () => {
    await capture()
    await expect(capture({ description: 'Changed' })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })

    await db.update(vendorAccounts).set({ enabled: false }).where(eq(vendorAccounts.id, accountId))
    await expect(capture({ clientKey: uuid(101) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(vendorAccounts).set({ enabled: true, nonSecretConfig: { unsafe: true } }).where(eq(vendorAccounts.id, accountId))
    await expect(capture({ clientKey: uuid(102) })).resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(capture({ clientKey: uuid(103), vendorAccountId: uuid(999) })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('returns unavailable without creating or invalidating a line', async () => {
    const [version] = await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 1, snapshot: snapshot(), createdByProfileId: uuid(1),
    }).returning()
    await expect(capture({ availability: 'unavailable' })).resolves.toEqual({ ok: true, changed: false, unavailable: true })
    expect(await db.select().from(jobLines)).toHaveLength(0)
    const [stored] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id))
    expect(stored.supersededAt).toBeNull()
  })

  it('requires reconciled open repair or maintenance work in open or blocked state', async () => {
    const states = [
      ['repair', 'blocked', true], ['maintenance', 'open', true], ['diagnostic', 'open', false],
      ['repair', 'in_progress', false], ['repair', 'done', false], ['repair', 'canceled', false],
    ] as const
    for (const [index, [kind, status, expected]] of states.entries()) {
      await db.update(ticketJobs).set({ kind, workStatus: status }).where(eq(ticketJobs.id, jobId))
      const result = await capture({ clientKey: uuid(200 + index) })
      expect(result.ok).toBe(expected)
    }
    await db.update(ticketJobs).set({ kind: 'repair', workStatus: 'open' }).where(eq(ticketJobs.id, jobId))
    const provisionalTicketId = uuid(31)
    const provisionalJobId = uuid(42)
    await db.insert(tickets).values({
      id: provisionalTicketId, shopId, ticketNumber: 2, source: 'tech_quick',
      customerId: null, vehicleId: null, concern: 'Provisional work',
      createdByProfileId: uuid(1),
    })
    await db.insert(ticketJobs).values({
      id: provisionalJobId, shopId, ticketId: provisionalTicketId,
      title: 'Provisional repair', kind: 'repair', requiredSkillTier: 1,
    })
    await expect(capture({ clientKey: uuid(300) }, {
      ticketId: provisionalTicketId,
      jobId: provisionalJobId,
    })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('rejects hostile inputs while canonicalizing equivalent decimal quantities for replay', async () => {
    for (const invalid of [
      { extra: true }, { priceCents: -1 },
      { fulfillment: { method: 'pickup', locationLabel: 'x', token: 'secret' } },
      { description: 'x'.repeat(501) }, { externalOfferId: 'x'.repeat(501) },
    ]) await expect(capture(invalid)).resolves.toEqual({ ok: false, error: 'invalid_input' })
    const first = await capture({ clientKey: uuid(350), quantity: '2.000' })
    expect(first).toMatchObject({ ok: true, changed: true, line: { quantity: '2' } })
    await expect(capture({ clientKey: uuid(350), quantity: '2' }))
      .resolves.toEqual({ ...first, changed: false })
  })

  it('invalidates active quote truth atomically and rolls back when invalidation fails', async () => {
    const [version] = await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 1, snapshot: snapshot(), createdByProfileId: uuid(1),
    }).returning()
    expect(await capture()).toMatchObject({ ok: true, changed: true })
    const [invalidated] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.id))
    expect(invalidated.supersededAt).not.toBeNull()

    await db.insert(quoteVersions).values({
      shopId, ticketId, versionNumber: 2, snapshot: { broken: true }, createdByProfileId: uuid(1),
    })
    await expect(capture({ clientKey: uuid(400) })).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(jobLines).where(eq(jobLines.id, uuid(400)))).toHaveLength(0)
  })

  it('removes only proposed unordered vendor offers and makes missing retries unchanged', async () => {
    await capture()
    await db.update(vendorAccounts).set({ displayName: 'Renamed', enabled: false })
      .where(eq(vendorAccounts.id, accountId))
    const [beforeTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [beforeJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    await expect(removeManualOffer(db, { actor, ticketId, jobId, lineId: uuid(100) }))
      .resolves.toEqual({ ok: true, changed: true })
    const [afterDeleteTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [afterDeleteJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(afterDeleteJob.revision).toBe(beforeJob.revision + 1n)
    expect(afterDeleteTicket.projectionRevision).toBe(beforeTicket.projectionRevision + 1n)
    expect(afterDeleteTicket.continuityRevision).toBe(beforeTicket.continuityRevision + 1n)
    await expect(removeManualOffer(db, { actor, ticketId, jobId, lineId: uuid(100) }))
      .resolves.toEqual({ ok: true, changed: false })
    const [afterNoopTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [afterNoopJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(afterNoopJob.revision).toBe(afterDeleteJob.revision)
    expect(afterNoopTicket.projectionRevision).toBe(afterDeleteTicket.projectionRevision)
    expect(afterNoopTicket.continuityRevision).toBe(afterDeleteTicket.continuityRevision)

    await db.update(vendorAccounts).set({ enabled: true }).where(eq(vendorAccounts.id, accountId))
    await capture({ clientKey: uuid(101) })
    await db.update(jobLines).set({ partStatus: 'ordered', orderedAt: new Date(), orderedByProfileId: uuid(1) })
      .where(eq(jobLines.id, uuid(101)))
    await expect(removeManualOffer(db, { actor, ticketId, jobId, lineId: uuid(101) }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('refuses to remove persisted offer truth when row and snapshot parity diverge', async () => {
    await capture()
    await db.update(jobLines).set({ unitCostCents: 5_001 }).where(eq(jobLines.id, uuid(100)))
    await expect(removeManualOffer(db, { actor, ticketId, jobId, lineId: uuid(100) }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(jobLines).where(eq(jobLines.id, uuid(100)))).toHaveLength(1)
  })

  it('captures the complete sorted lock order in source', async () => {
    const source = await readFile(join(process.cwd(), 'lib/shop-os/parts-offers.ts'), 'utf8')
    const captureSource = source.slice(
      source.indexOf('export async function captureManualOffer'),
      source.indexOf('export async function removeManualOffer'),
    )
    const removeSource = source.slice(source.indexOf('export async function removeManualOffer'))
    for (const writer of [captureSource, removeSource]) {
      expect(writer).toContain('runBoundedShopOsMutationV1')
      expect(writer).toContain('assertLiveLockedMutationScopeV1')
      expect(writer.match(/finalizeMutationRevisionsV1/g)).toHaveLength(1)
      expect(writer).toContain('afterDiscovery')
      expect(writer).toContain('afterWrite')
      expect(writer).toContain('afterFinalization')
      expect(writer).not.toContain('.transaction(')
      expect(writer).not.toContain(".for('update'")
      expect(writer).not.toMatch(/revision:\s*sql/)
    }
    for (const closureToken of [
      'separateFromTicketId', 'createdByProfileId', 'assignedTechId',
      'statementConfirmedByProfileId', 'orderedByProfileId', 'receivedByProfileId',
      'sessionId', 'techId', 'vendorAccountId', 'actorProfileId',
      'includeAllJobsForTickets', 'includeAllLinesForJobs',
      'includeAllQuoteVersionsForTickets', 'includeAllQuoteEventsForTickets',
    ]) expect(source).toContain(closureToken)
  })

  it.each(['afterDiscovery', 'afterWrite', 'afterFinalization'] as const)(
    'rolls capture back completely at %s',
    async (seam) => {
      const beforeTickets = await db.select().from(tickets)
      const beforeJobs = await db.select().from(ticketJobs)
      const beforeLines = await db.select().from(jobLines)

      await expect(capture({}, {}, {
        [seam]: async () => { throw new Error(`capture-${seam}`) },
      })).rejects.toThrow(`capture-${seam}`)

      expect(await db.select().from(tickets)).toEqual(beforeTickets)
      expect(await db.select().from(ticketJobs)).toEqual(beforeJobs)
      expect(await db.select().from(jobLines)).toEqual(beforeLines)
    },
  )

  it.each(['afterDiscovery', 'afterWrite', 'afterFinalization'] as const)(
    'rolls removal back completely at %s',
    async (seam) => {
      await capture()
      const beforeTickets = await db.select().from(tickets)
      const beforeJobs = await db.select().from(ticketJobs)
      const beforeLines = await db.select().from(jobLines)

      await expect(removeManualOffer(
        db,
        { actor, ticketId, jobId, lineId: uuid(100) },
        { [seam]: async () => { throw new Error(`remove-${seam}`) } },
      )).rejects.toThrow(`remove-${seam}`)

      expect(await db.select().from(tickets)).toEqual(beforeTickets)
      expect(await db.select().from(ticketJobs)).toEqual(beforeJobs)
      expect(await db.select().from(jobLines)).toEqual(beforeLines)
    },
  )

  it.each(['55P03', '40001', '40P01'])(
    'exhausts bounded capture retries for SQLSTATE %s without residue',
    async (code) => {
      let attempts = 0
      await expect(capture({}, {}, {
        afterWrite: async () => {
          attempts += 1
          throw Object.assign(new Error(code), { code })
        },
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })
      expect(attempts).toBe(2)
      expect(await db.select().from(jobLines)).toHaveLength(0)
    },
  )

  function snapshot() {
    return {
      schemaVersion: 1,
      ticket: { id: ticketId, number: 1, customerId: uuid(20), vehicleId: uuid(21), laborRateCents: null, taxRateBps: 0 },
      jobs: [{ id: jobId, title: 'Front brakes', kind: 'repair', customerStory: null, storyMeta: null, lines: [], attachments: [], totals: { subtotalCents: 0, taxableSubtotalCents: 0 } }],
      totals: { subtotalCents: 0, taxableSubtotalCents: 0, taxCents: 0, totalCents: 0 },
    }
  }
})
