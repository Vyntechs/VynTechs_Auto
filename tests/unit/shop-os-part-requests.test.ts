import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '@/tests/helpers/db'
import {
  customers, jobPartRequests, profiles, shopEntitlements, shops, ticketJobs, tickets, vehicles,
} from '@/lib/db/schema'
import {
  createPartRequest,
  listPartRequestsForJob,
  listPartRequestsForTicket,
  resolvePartRequest,
  type PartRequestActor,
} from '@/lib/shop-os/part-requests'

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('Shop OS job part requests', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  const techId = uuid(1)
  const otherTechId = uuid(2)
  const partsId = uuid(3)
  const advisorId = uuid(4)
  const ticketId = uuid(20)
  const jobId = uuid(30)
  let techActor: PartRequestActor
  let partsActor: PartRequestActor

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop] = await db.insert(shops).values({ name: 'North', laborRateCents: 15_000, taxRateBps: 825 }).returning()
    shopId = shop.id
    techActor = { profileId: techId, shopId }
    partsActor = { profileId: partsId, shopId }
    await db.insert(profiles).values([
      { id: techId, userId: uuid(101), shopId, role: 'tech', skillTier: 2, fullName: 'Alex Tech' },
      { id: otherTechId, userId: uuid(102), shopId, role: 'tech', skillTier: 2, fullName: 'Other Tech' },
      { id: partsId, userId: uuid(103), shopId, role: 'parts', skillTier: 1, fullName: 'Pat Parts' },
      { id: advisorId, userId: uuid(104), shopId, role: 'advisor', skillTier: 3, fullName: 'Sam Advisor' },
    ])
    await db.insert(customers).values({ id: uuid(10), shopId, name: 'Customer', phone: '5550102026' })
    await db.insert(vehicles).values({ id: uuid(11), customerId: uuid(10), year: 2020, make: 'Jeep', model: 'Wrangler' })
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 1, source: 'counter', customerId: uuid(10),
      vehicleId: uuid(11), concern: 'Water pump', createdByProfileId: advisorId,
    })
    await db.insert(ticketJobs).values({
      id: jobId, shopId, ticketId, title: 'Replace water pump', kind: 'repair',
      requiredSkillTier: 2, assignedTechId: techId, workStatus: 'in_progress', approvalState: 'approved',
    })
  })

  afterEach(async () => close())

  const body = (overrides: Record<string, unknown> = {}) => ({
    requestKey: uuid(80), description: 'Water pump', preference: 'Motorcraft from the dealer', quantity: 1, ...overrides,
  })

  it('lets the assigned tech flag a part with zero money, idempotently', async () => {
    const first = await createPartRequest(db, { actor: techActor, ticketId, jobId, body: body() })
    expect(first).toMatchObject({
      ok: true,
      request: { description: 'Water pump', preference: 'Motorcraft from the dealer', quantity: 1, status: 'requested', resolvedAt: null },
    })
    const replay = await createPartRequest(db, { actor: techActor, ticketId, jobId, body: body() })
    expect(replay).toMatchObject({ ok: true, request: { id: first.ok ? first.request.id : 'x' } })
    expect(await db.select().from(jobPartRequests)).toHaveLength(1)
    // The request carries no cost or price — it never touches the quote/money.
    const [row] = await db.select().from(jobPartRequests)
    expect(Object.keys(row)).not.toContain('price_cents')
    expect(Object.keys(row)).not.toContain('unit_cost_cents')
  })

  it('lets diagnostics-off manual work request parts without reopening entitled diagnostics', async () => {
    const diagnosticJobId = uuid(31)
    await db.insert(ticketJobs).values({
      id: diagnosticJobId,
      shopId,
      ticketId,
      title: 'Manual charging-system diagnosis',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      assignedTechId: techId,
      workStatus: 'in_progress',
      approvalState: 'approved',
    })
    await db.insert(shopEntitlements).values({ shopId, diagnostics: false })

    await expect(createPartRequest(db, {
      actor: techActor,
      ticketId,
      jobId: diagnosticJobId,
      body: body({ requestKey: uuid(85), description: 'Alternator' }),
    })).resolves.toMatchObject({ ok: true, request: { description: 'Alternator' } })

    await db.update(shopEntitlements).set({ diagnostics: true })
      .where(eq(shopEntitlements.shopId, shopId))
    await expect(createPartRequest(db, {
      actor: techActor,
      ticketId,
      jobId: diagnosticJobId,
      body: body({ requestKey: uuid(86), description: 'Battery cable' }),
    })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('rejects a tech who is not the one assigned, and inactive callers', async () => {
    await expect(createPartRequest(db, { actor: { profileId: otherTechId, shopId }, ticketId, jobId, body: body() }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ deactivatedAt: new Date() }).where(eq(profiles.id, techId))
    await expect(createPartRequest(db, { actor: techActor, ticketId, jobId, body: body() }))
      .resolves.toEqual({ ok: false, error: 'not_authorized' })
    expect(await db.select().from(jobPartRequests)).toHaveLength(0)
  })

  it('normalizes an empty preference to null and validates quantity', async () => {
    const noPref = await createPartRequest(db, { actor: techActor, ticketId, jobId, body: body({ requestKey: uuid(81), preference: '   ' }) })
    expect(noPref).toMatchObject({ ok: true, request: { preference: null } })
    await expect(createPartRequest(db, { actor: techActor, ticketId, jobId, body: body({ requestKey: uuid(82), quantity: 0 }) }))
      .resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(createPartRequest(db, { actor: techActor, ticketId, jobId, body: body({ requestKey: uuid(83), description: '' }) }))
      .resolves.toEqual({ ok: false, error: 'invalid_input' })
  })

  it('lets parts/advisor/owner mark a request handled, and rejects a tech doing so', async () => {
    const created = await createPartRequest(db, { actor: techActor, ticketId, jobId, body: body() })
    if (!created.ok) throw new Error('create failed')
    const requestId = created.request.id

    await expect(resolvePartRequest(db, { actor: techActor, ticketId, requestId, body: { status: 'sourced' } }))
      .resolves.toEqual({ ok: false, error: 'not_authorized' })

    const sourced = await resolvePartRequest(db, { actor: partsActor, ticketId, requestId, body: { status: 'sourced' } })
    expect(sourced).toMatchObject({ ok: true, request: { status: 'sourced' } })
    expect(sourced.ok && sourced.request.resolvedAt).toEqual(expect.any(String))

    // Same verdict again is idempotent; a different verdict conflicts.
    await expect(resolvePartRequest(db, { actor: partsActor, ticketId, requestId, body: { status: 'sourced' } }))
      .resolves.toMatchObject({ ok: true, request: { status: 'sourced' } })
    await expect(resolvePartRequest(db, { actor: partsActor, ticketId, requestId, body: { status: 'dismissed' } }))
      .resolves.toEqual({ ok: false, error: 'conflict' })
  })

  it('lists a job\'s requests for the tech and the ticket\'s requests with names for parts', async () => {
    await createPartRequest(db, { actor: techActor, ticketId, jobId, body: body({ requestKey: uuid(84), description: 'Serpentine belt', preference: null }) })
    const jobList = await listPartRequestsForJob(db, { shopId, jobId })
    expect(jobList).toHaveLength(1)
    expect(jobList[0]).toMatchObject({ description: 'Serpentine belt', preference: null, status: 'requested' })

    const ticketList = await listPartRequestsForTicket(db, { shopId, ticketId })
    expect(ticketList[0]).toMatchObject({
      description: 'Serpentine belt', jobTitle: 'Replace water pump', requestedByName: 'Alex Tech',
    })
  })

  it.each([
    ['pending_quote', 'in_progress'],
    ['quote_ready', 'in_progress'],
    ['sent', 'in_progress'],
    ['declined', 'in_progress'],
    ['approved', 'open'],
    ['approved', 'blocked'],
    ['approved', 'done'],
    ['approved', 'canceled'],
  ] as const)('rejects parts creation for approval=%s and work=%s', async (approvalState, workStatus) => {
    await db.update(ticketJobs).set({ approvalState, workStatus }).where(eq(ticketJobs.id, jobId))
    await expect(createPartRequest(db, {
      actor: techActor,
      ticketId,
      jobId,
      body: body(),
    })).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(jobPartRequests)).toHaveLength(0)
  })

  it('enforces 50 open requests while preserving exact-key replay', async () => {
    await db.insert(jobPartRequests).values(Array.from({ length: 50 }, (_, index) => ({
      shopId,
      ticketId,
      jobId,
      requestedByProfileId: techId,
      description: `Seeded part ${index}`,
      quantity: 1,
      requestKey: uuid(1_000 + index),
    })))

    await expect(createPartRequest(db, {
      actor: techActor,
      ticketId,
      jobId,
      body: body({ requestKey: uuid(1_000), description: 'Seeded part 0' }),
    })).resolves.toMatchObject({ ok: true, request: { description: 'Seeded part 0' } })

    await expect(createPartRequest(db, {
      actor: techActor,
      ticketId,
      jobId,
      body: body({ requestKey: uuid(2_000) }),
    })).resolves.toEqual({ ok: false, error: 'conflict' })
    expect(await db.select().from(jobPartRequests)).toHaveLength(50)
  })

  it('serializes concurrent creates at the open-request ceiling', async () => {
    await db.insert(jobPartRequests).values(Array.from({ length: 49 }, (_, index) => ({
      shopId,
      ticketId,
      jobId,
      requestedByProfileId: techId,
      description: `Seeded part ${index}`,
      quantity: 1,
      requestKey: uuid(3_000 + index),
    })))

    const results = await Promise.all([
      createPartRequest(db, { actor: techActor, ticketId, jobId, body: body({ requestKey: uuid(4_001) }) }),
      createPartRequest(db, { actor: techActor, ticketId, jobId, body: body({ requestKey: uuid(4_002) }) }),
    ])

    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: 'conflict' }])
    expect(await db.select().from(jobPartRequests)).toHaveLength(50)
  })

  it('bounds job and ticket history projections to 100 current-first rows', async () => {
    await db.insert(jobPartRequests).values(Array.from({ length: 110 }, (_, index) => ({
      shopId,
      ticketId,
      jobId,
      requestedByProfileId: techId,
      description: `Historical part ${index}`,
      quantity: 1,
      requestKey: uuid(5_000 + index),
      createdAt: new Date(Date.UTC(2026, 6, 19, 0, index)),
    })))

    const jobRows = await listPartRequestsForJob(db, { shopId, jobId })
    const ticketRows = await listPartRequestsForTicket(db, { shopId, ticketId })
    expect(jobRows).toHaveLength(100)
    expect(ticketRows).toHaveLength(100)
    expect(jobRows[0].description).toBe('Historical part 109')
    expect(ticketRows[0].description).toBe('Historical part 109')
  })
})
