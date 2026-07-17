import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import type { Sql, TransactionSql } from 'postgres'
import {
  assertContinuityPostgresUrlV1,
  createPostgresContinuityDb,
  type PostgresContinuityHarness,
} from '@/tests/helpers/postgres-continuity-db'
import {
  cannedJobs,
  customers,
  jobLines,
  profiles,
  quoteEvents,
  quoteVersions,
  sessionEvents,
  sessions,
  shops,
  ticketJobs,
  tickets,
  vendorAccounts,
  vehicles,
} from '@/lib/db/schema'
import {
  addTicketJob,
  mutateTicketJobAssignment,
  type TicketActor,
} from '@/lib/tickets'
import { recordQuoteDecision } from '@/lib/shop-os/quotes'
import { createQuoteVersion } from '@/lib/shop-os/quotes'
import { replaceDraftLine } from '@/lib/shop-os/quotes'
import { approveDeferredSession } from '@/lib/curator/deferred-actions'
import { updateAdaptiveModeForUser } from '@/lib/diagnostics/adaptive/state'
import { closeSessionForUser } from '@/lib/sessions'
import { createSessionForUser } from '@/lib/sessions'
import type { AdaptiveCoverage, AdaptiveDiagnosticState } from '@/lib/diagnostics/adaptive/contracts'
import { createCounterTicket } from '@/lib/intake/counter-ticket'
import { createQuickTicket } from '@/lib/intake/quick-ticket'
import { createCannedJob } from '@/lib/shop-os/canned-jobs'
import { createMutationFingerprintKeyringV1 } from '@/lib/shop-os/continuity/mutation-foundation/keyring'
import { saveReviewedCustomerStory } from '@/lib/shop-os/customer-stories'
import {
  acquireDiagnosticStart,
  finalizeDiagnosticStart,
} from '@/lib/shop-os/diagnostic-start'
import { mutateSimpleWork } from '@/lib/shop-os/simple-work'
import { captureManualOffer, removeManualOffer } from '@/lib/shop-os/parts-offers'

const postgresUrl = process.env.CONTINUITY_POSTGRES_URL
const requirePostgres = process.env.REQUIRE_CONTINUITY_POSTGRES === '1'
const uuid = (suffix: number) =>
  `10000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const proofClosedCoverage: AdaptiveCoverage = {
  state: 'exact',
  system: 'fuel',
  symptomSlug: 'p0087',
  reasons: ['Field-verified.'],
  technicianInstructionsAvailable: true,
  instructionProof: {
    componentIds: [uuid(170)],
    testActionIds: [uuid(171)],
    branchLogicIds: [],
    verifiedAxes: ['exact:fuel-system'],
  },
}

const adaptiveState = (
  mode: 'guided' | 'manual',
): AdaptiveDiagnosticState => ({
  schemaVersion: 1,
  mode,
  coverage: proofClosedCoverage,
  currentTestActionId: null,
  finding: null,
})

const postgresMutationKeyring = createMutationFingerprintKeyringV1({
  SHOP_OS_MUTATION_HMAC_ACTIVE_VERSION: '1',
  SHOP_OS_MUTATION_HMAC_KEYS_B64: `1:${Buffer.alloc(32, 17).toString('base64')}`,
})

describe('continuity PostgreSQL integration configuration', () => {
  it('fails closed when PostgreSQL is required or a configured URL is unsafe', () => {
    if (requirePostgres) expect(postgresUrl).toBeTruthy()
    if (postgresUrl) expect(() => assertContinuityPostgresUrlV1(postgresUrl)).not.toThrow()
  })
})

describe.skipIf(!postgresUrl)('ShopOS continuity real PostgreSQL races', () => {
  let harness: PostgresContinuityHarness

  beforeAll(async () => {
    harness = await createPostgresContinuityDb(postgresUrl)
  }, 120_000)

  afterAll(async () => {
    await harness?.cleanup()
  })

  it('uses two independent clients and every source migration through 0037', () => {
    expect(harness.clientA).not.toBe(harness.clientB)
    expect(harness.dbA).not.toBe(harness.dbB)
    expect(harness.migrationFiles[0]).toBe('0000_whole_domino.sql')
    expect(harness.migrationFiles.at(-1)).toBe('0037_shop_os_continuity_foundation.sql')
    expect(harness.migrationFiles).toContain('0011a_session_curator_columns.sql')
    expect(harness.migrationFiles).toContain('0011b_session_max_corpus_similarity.sql')
  })

  it('serializes the production assignment and quote-decision writers with exact revision cardinality', async () => {
    const { dbA, dbB } = harness
    const [shop] = await dbA.insert(shops).values({
      id: uuid(1),
      name: 'Postgres Race Shop',
      laborRateCents: 15_000,
      taxRateBps: 825,
    }).returning()
    const advisorId = uuid(2)
    const techId = uuid(3)
    const customerId = uuid(4)
    const vehicleId = uuid(5)
    const ticketId = uuid(6)
    const jobId = uuid(7)
    const quoteVersionId = uuid(8)
    await dbA.insert(profiles).values([
      { id: advisorId, userId: uuid(102), shopId: shop.id, role: 'advisor' },
      { id: techId, userId: uuid(103), shopId: shop.id, role: 'tech', skillTier: 2 },
    ])
    await dbA.insert(customers).values({
      id: customerId,
      shopId: shop.id,
      name: 'Postgres Customer',
      phone: '5552000000',
    })
    await dbA.insert(vehicles).values({
      id: vehicleId,
      customerId,
      year: 2021,
      make: 'Ford',
      model: 'F-150',
    })
    await dbA.insert(tickets).values({
      id: ticketId,
      shopId: shop.id,
      ticketNumber: 1,
      source: 'counter',
      customerId,
      vehicleId,
      concern: 'Brake noise',
      createdByProfileId: advisorId,
    })
    await dbA.insert(ticketJobs).values({
      id: jobId,
      shopId: shop.id,
      ticketId,
      title: 'Front brakes',
      kind: 'repair',
      requiredSkillTier: 1,
      approvalState: 'quote_ready',
    })
    await dbA.insert(quoteVersions).values({
      id: quoteVersionId,
      shopId: shop.id,
      ticketId,
      versionNumber: 1,
      createdByProfileId: advisorId,
      snapshot: {
        schemaVersion: 1,
        ticket: {
          id: ticketId,
          number: 1,
          customerId,
          vehicleId,
          laborRateCents: 15_000,
          taxRateBps: 825,
        },
        jobs: [{
          id: jobId,
          title: 'Front brakes',
          kind: 'repair',
          customerStory: null,
          storyMeta: null,
          lines: [{
            id: uuid(9),
            kind: 'fee',
            description: 'Inspection',
            quantity: '1',
            priceCents: 500,
            taxable: true,
            partNumber: null,
            brand: null,
            coreChargeCents: null,
            fitment: null,
            laborHours: null,
            laborRateCents: null,
            source: 'manual',
            vendorContext: null,
          }],
          attachments: [],
          totals: { subtotalCents: 500, taxableSubtotalCents: 500 },
        }],
        totals: {
          subtotalCents: 500,
          taxableSubtotalCents: 500,
          taxCents: 41,
          totalCents: 541,
        },
      },
    })
    const actor: TicketActor = {
      profileId: techId,
      shopId: shop.id,
      role: 'tech',
      skillTier: 2,
      membershipStatus: 'active',
      deactivatedAt: null,
    }

    const [assignment, racedDecision] = await Promise.all([
      mutateTicketJobAssignment(dbA, {
        actor,
        ticketId,
        jobId,
        body: { action: 'claim' },
      }),
      recordQuoteDecision(dbB, {
        actor: { profileId: advisorId },
        ticketId,
        body: {
          requestKey: uuid(10),
          jobId,
          quoteVersionId,
          decision: 'approved',
          approvedVia: 'phone',
        },
      }),
    ])

    const decision = racedDecision.ok
      ? racedDecision
      : await recordQuoteDecision(dbB, {
          actor: { profileId: advisorId },
          ticketId,
          body: {
            requestKey: uuid(10),
            jobId,
            quoteVersionId,
            decision: 'approved',
            approvedVia: 'phone',
          },
        })
    expect(assignment).toMatchObject({ ok: true })
    if (!racedDecision.ok) {
      expect(racedDecision).toEqual({ ok: false, error: 'conflict', retryable: true })
    }
    expect(decision).toMatchObject({ ok: true, changed: true })
    const [ticket] = await dbA.select().from(tickets).where(eq(tickets.id, ticketId))
    const [job] = await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(job).toMatchObject({
      assignedTechId: techId,
      approvalState: 'approved',
      revision: 2n,
    })
    expect(ticket).toMatchObject({ projectionRevision: 2n, continuityRevision: 1n })
    expect(await dbA.select().from(quoteEvents)).toHaveLength(1)
  }, 20_000)

  it('proves a real 250ms row-lock timeout without deadlock', async () => {
    const { clientA, clientB } = harness
    const ticketId = uuid(6)
    let release!: () => void
    let locked!: () => void
    const releasePromise = new Promise<void>((resolveRelease) => { release = resolveRelease })
    const lockedPromise = new Promise<void>((resolveLocked) => { locked = resolveLocked })
    const holder = clientA.begin(async (tx) => {
      await tx`select id from tickets where id = ${ticketId}::uuid for update`
      locked()
      await releasePromise
    })
    await lockedPromise
    const startedAt = Date.now()
    let timeoutError: unknown
    try {
      await clientB.begin(async (tx) => {
        await tx.unsafe("set local lock_timeout = '250ms'")
        await tx`select id from tickets where id = ${ticketId}::uuid for update`
      })
    } catch (error) {
      timeoutError = error
    } finally {
      release()
      await holder
    }
    const elapsed = Date.now() - startedAt
    expect(timeoutError).toMatchObject({ code: '55P03' })
    expect(elapsed).toBeGreaterThanOrEqual(200)
    expect(elapsed).toBeLessThan(2_000)
  }, 10_000)

  it('serializes curator mutation versus the session foreign-key link in both orderings', async () => {
    const { clientA, clientB, dbA, dbB } = harness
    const shopId = uuid(1)
    const techId = uuid(3)
    const advisorId = uuid(2)
    const sessionLinkFirst = uuid(30)
    const sessionCuratorFirst = uuid(31)
    const ticketId = uuid(32)
    const linkFirstJobId = uuid(33)
    const curatorFirstJobId = uuid(34)
    const sessionShape = (id: string) => ({
      id,
      shopId,
      techId,
      status: 'deferred' as const,
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'Deferred race',
      },
      treeState: {
        nodes: [{ id: 'root', label: 'Verify', status: 'active' as const }],
        currentNodeId: 'root',
        message: 'Deferred.',
      },
      closedAt: new Date('2026-07-17T12:00:00Z'),
    })
    await dbA.insert(sessions).values([
      sessionShape(sessionLinkFirst),
      sessionShape(sessionCuratorFirst),
    ])
    await dbA.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 2,
      source: 'counter',
      customerId: uuid(4),
      vehicleId: uuid(5),
      concern: 'Curator FK race',
      createdByProfileId: advisorId,
    })
    await dbA.insert(ticketJobs).values([
      {
        id: linkFirstJobId,
        shopId,
        ticketId,
        title: 'Link first',
        kind: 'diagnostic',
        requiredSkillTier: 1,
        sequenceNumber: 1,
      },
      {
        id: curatorFirstJobId,
        shopId,
        ticketId,
        title: 'Curator first',
        kind: 'diagnostic',
        requiredSkillTier: 1,
        sequenceNumber: 2,
      },
    ])

    let linkWritten!: () => void
    let releaseLink!: () => void
    const linkWrittenPromise = new Promise<void>((resolveWritten) => { linkWritten = resolveWritten })
    const releaseLinkPromise = new Promise<void>((resolveRelease) => { releaseLink = resolveRelease })
    const linkFirst = clientA.begin(async (tx) => {
      await tx`update ticket_jobs set session_id = ${sessionLinkFirst}::uuid where id = ${linkFirstJobId}::uuid`
      linkWritten()
      await releaseLinkPromise
    })
    await linkWrittenPromise
    const linkedCurator = approveDeferredSession(dbB, sessionLinkFirst, 'late curator')
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    releaseLink()
    await linkFirst
    await expect(linkedCurator).resolves.toEqual({ kind: 'not-found' })
    const [linkedSession] = await dbA.select().from(sessions).where(eq(sessions.id, sessionLinkFirst))
    expect(linkedSession.status).toBe('deferred')

    let curatorLocked!: () => void
    let releaseCurator!: () => void
    const curatorLockedPromise = new Promise<void>((resolveLocked) => { curatorLocked = resolveLocked })
    const releaseCuratorPromise = new Promise<void>((resolveRelease) => { releaseCurator = resolveRelease })
    const curatorFirst = clientA.begin(async (tx) => {
      await tx`select id from sessions where id = ${sessionCuratorFirst}::uuid for update`
      curatorLocked()
      await releaseCuratorPromise
      const links = await tx`select id from ticket_jobs where session_id = ${sessionCuratorFirst}::uuid`
      if (links.length !== 0) throw new Error('curator_first_link_visible_too_early')
      await tx`update sessions set status = 'open', closed_at = null where id = ${sessionCuratorFirst}::uuid`
    })
    await curatorLockedPromise
    const lateLink = clientB`
      update ticket_jobs set session_id = ${sessionCuratorFirst}::uuid
      where id = ${curatorFirstJobId}::uuid
    `
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    releaseCurator()
    await Promise.all([curatorFirst, lateLink])
    const [mutatedThenLinked] = await dbA.select().from(sessions).where(eq(sessions.id, sessionCuratorFirst))
    expect(mutatedThenLinked.status).toBe('open')
    expect((await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, curatorFirstJobId)))[0].sessionId)
      .toBe(sessionCuratorFirst)
  }, 20_000)

  it('classifies real sessions_pkey and receipt request-key uniqueness winners', async () => {
    const { clientA, clientB } = harness
    const shopId = uuid(1)
    const techId = uuid(3)
    const sessionId = uuid(40)
    const sessionJson = JSON.stringify({
      vehicleYear: 2020,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'Unique collision',
    })
    const treeJson = JSON.stringify({
      nodes: [{ id: 'root', label: 'Verify', status: 'active' }],
      currentNodeId: 'root',
      message: 'Begin.',
    })
    let sessionInserted!: () => void
    let releaseSession!: () => void
    const sessionInsertedPromise = new Promise<void>((resolveInserted) => { sessionInserted = resolveInserted })
    const releaseSessionPromise = new Promise<void>((resolveRelease) => { releaseSession = resolveRelease })
    const sessionWinner = clientA.begin(async (tx) => {
      await tx`
        insert into sessions (id, tech_id, shop_id, intake, tree_state)
        values (${sessionId}::uuid, ${techId}::uuid, ${shopId}::uuid,
          ${sessionJson}::jsonb, ${treeJson}::jsonb)
      `
      sessionInserted()
      await releaseSessionPromise
    })
    await sessionInsertedPromise
    const sessionLoser = clientB`
      insert into sessions (id, tech_id, shop_id, intake, tree_state)
      values (${sessionId}::uuid, ${techId}::uuid, ${shopId}::uuid,
        ${sessionJson}::jsonb, ${treeJson}::jsonb)
    `.then(() => null, (error: unknown) => error)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    releaseSession()
    await sessionWinner
    expect(await sessionLoser).toMatchObject({ code: '23505', constraint_name: 'sessions_pkey' })

    const requestKey = uuid(50)
    const receiptWinnerId = uuid(51)
    let receiptInserted!: () => void
    let releaseReceipt!: () => void
    const receiptInsertedPromise = new Promise<void>((resolveInserted) => { receiptInserted = resolveInserted })
    const releaseReceiptPromise = new Promise<void>((resolveRelease) => { releaseReceipt = resolveRelease })
    const insertReceipt = async (
      tx: Sql | TransactionSql,
      receiptId: string,
      fingerprint: string,
    ) => tx`
      insert into ticket_mutation_receipts
        (id, shop_id, request_key, mutation_schema_version,
         fingerprint_key_version, mutation_kind, actor_profile_id,
         target_ticket_id, target_binding_fingerprint, request_fingerprint,
         result_ticket_id, result_job_count)
      values
        (${receiptId}::uuid, ${shopId}::uuid, ${requestKey}::uuid, 1, 1,
         'create_repair_order', ${uuid(2)}::uuid, null,
         ${'a'.repeat(64)}, ${fingerprint}, ${uuid(6)}::uuid, 0)
    `
    const receiptWinner = clientA.begin(async (tx) => {
      await insertReceipt(tx, receiptWinnerId, 'b'.repeat(64))
      receiptInserted()
      await releaseReceiptPromise
    })
    await receiptInsertedPromise
    const receiptLoser = insertReceipt(clientB, uuid(52), 'c'.repeat(64))
      .then(() => null, (error: unknown) => error)
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    releaseReceipt()
    await receiptWinner
    expect(await receiptLoser).toMatchObject({
      code: '23505',
      constraint_name: 'ticket_mutation_receipts_shop_request_key_uq',
    })
    const receipts = await clientA`
      select id from ticket_mutation_receipts
      where shop_id = ${shopId}::uuid and request_key = ${requestKey}::uuid
    `
    expect(receipts).toEqual([{ id: receiptWinnerId }])
  }, 20_000)

  it('classifies production Tech Quick exact, changed, cross-actor, and cross-shop sessions_pkey races', async () => {
    const { dbA, dbB } = harness
    const shopId = uuid(200)
    const otherShopId = uuid(201)
    const firstProfileId = uuid(202)
    const otherProfileId = uuid(203)
    const crossShopProfileId = uuid(204)
    const requestKey = uuid(205)
    await dbA.insert(shops).values([
      { id: shopId, name: 'Tech Quick PostgreSQL North' },
      { id: otherShopId, name: 'Tech Quick PostgreSQL South' },
    ])
    await dbA.insert(profiles).values([
      { id: firstProfileId, userId: uuid(302), shopId, role: 'tech', skillTier: 2 },
      { id: otherProfileId, userId: uuid(303), shopId, role: 'owner', skillTier: 3 },
      { id: crossShopProfileId, userId: uuid(304), shopId: otherShopId, role: 'tech', skillTier: 2 },
    ])
    const intake = {
      vehicleYear: 2018,
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      customerComplaint: 'Loss of power going up hills',
    }
    const treeState = {
      nodes: [{ id: 'root', label: 'Initial scan', status: 'pending' as const }],
      currentNodeId: 'root',
      message: 'Starting.',
    }
    const createFor = (db: PostgresContinuityHarness['dbA'], userId: string, body = intake) =>
      createSessionForUser({
        db,
        userId,
        body: { ...body, requestKey },
        treeState,
      })

    const first = await createFor(dbA, uuid(302))
    const exactReplay = await createFor(dbB, uuid(302))
    expect(exactReplay).toEqual(first)
    expect(first).toMatchObject({ ok: true, id: requestKey })
    const changed = await createFor(dbB, uuid(302), {
      ...intake,
      customerComplaint: 'Changed complaint text',
    })
    const crossActor = await createFor(dbB, uuid(303))
    const crossShop = await createFor(dbB, uuid(304))
    for (const result of [changed, crossActor, crossShop]) {
      expect(result).toEqual({ ok: false, status: 400, error: 'request key unavailable' })
    }
    expect(await dbA.select().from(sessions).where(eq(sessions.id, requestKey))).toHaveLength(1)
    expect(await dbA.select().from(ticketJobs).where(eq(ticketJobs.sessionId, requestKey)))
      .toEqual([expect.objectContaining({ assignedTechId: firstProfileId })])
    expect(await dbA.select().from(tickets).where(eq(tickets.shopId, shopId))).toHaveLength(1)
    expect(await dbA.select().from(tickets).where(eq(tickets.shopId, otherShopId))).toEqual([])
  }, 30_000)

  it('restarts production Quick Ticket after concurrent canned and tax drift without late locks or writes', async () => {
    const { clientA, dbA, dbB } = harness
    const shopId = uuid(210)
    const profileId = uuid(211)
    const customerId = uuid(215)
    const vehicleId = uuid(216)
    await dbA.insert(shops).values({
      id: shopId,
      name: 'Quick drift PostgreSQL',
      taxRateBps: 825,
    })
    const [profile] = await dbA.insert(profiles).values({
      id: profileId,
      userId: uuid(311),
      shopId,
      role: 'owner',
      skillTier: 3,
    }).returning()
    const actor: TicketActor = {
      profileId: profile.id,
      shopId,
      role: profile.role,
      skillTier: profile.skillTier,
      membershipStatus: profile.membershipStatus,
      deactivatedAt: profile.deactivatedAt,
    }
    const template = await createCannedJob(dbA, {
      actor: { profileId },
      clientKey: uuid(212),
      body: {
        title: 'Brake service',
        kind: 'repair',
        defaultRequiredSkillTier: 2,
        sort: 10,
        lines: [{
          kind: 'fee',
          description: 'Inspection',
          sort: 1,
          priceCents: 500,
          taxable: true,
        }],
      },
    })
    if (!template.ok) throw new Error('PostgreSQL canned fixture failed')
    const body = {
      vehicleMode: 'new' as const,
      customer: { name: 'Maria Lopez', phone: '555-0210', email: 'maria210@example.com' },
      vehicle: {
        year: 2018,
        make: 'Ford',
        model: 'F-150',
        engine: '3.5L EcoBoost',
        vin: '1FTEW1EP5JFC10210',
        mileage: 84_000,
        plate: 'PG210',
      },
      clientKey: uuid(213),
      quote: {
        mode: 'canned' as const,
        cannedJobId: template.cannedJob.id,
        expectedFingerprint: template.cannedJob.fingerprint,
        expectedTaxRateBps: 825,
      },
    }
    let shopLocked!: () => void
    let mutationStarted!: () => void
    const shopLockedPromise = new Promise<void>((resolveLocked) => { shopLocked = resolveLocked })
    const mutationStartedPromise = new Promise<void>((resolveStarted) => {
      mutationStarted = resolveStarted
    })
    const drift = clientA.begin(async (tx) => {
      await tx`select id from shops where id = ${shopId}::uuid for update`
      shopLocked()
      await mutationStartedPromise
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
      await tx`update shops set tax_rate_bps = 900 where id = ${shopId}::uuid`
      await tx`
        update canned_jobs set retired_at = now()
        where id = ${template.cannedJob.id}::uuid
      `
      await tx`
        insert into customers (id, shop_id, name, phone, email)
        values (${customerId}::uuid, ${shopId}::uuid, 'Maria Lopez', '555-0210', 'maria210@example.com')
      `
      await tx`
        insert into vehicles (id, customer_id, year, make, model, engine, vin, mileage, plate)
        values (${vehicleId}::uuid, ${customerId}::uuid, 2018, 'Ford', 'F-150',
          '3.5L EcoBoost', '1FTEW1EP5JFC10210', 84000, 'PG210')
      `
    })
    await shopLockedPromise
    const quick = (async () => {
      mutationStarted()
      return createQuickTicket(dbB, { actor, body }, {
        loadMutationKeyring: () => postgresMutationKeyring,
      })
    })()
    const settled = await Promise.allSettled([drift, quick])
    for (const result of settled) {
      if (result.status === 'rejected') throw result.reason
    }
    if (settled[1].status !== 'fulfilled') throw new Error('Quick drift did not settle')
    expect([
      { ok: false, error: 'not_found' },
      { ok: false, error: 'conflict', retryable: true },
    ]).toContainEqual(settled[1].value)
    expect(await dbA.select().from(tickets).where(eq(tickets.shopId, shopId))).toEqual([])
    expect(await dbA.select().from(ticketJobs).where(eq(ticketJobs.shopId, shopId))).toEqual([])
    expect((await dbA.select().from(shops).where(eq(shops.id, shopId)))[0].nextTicketNumber)
      .toBe(1)
  }, 30_000)

  it('restarts production Quick Ticket after customer and vehicle identities appear after preflight', async () => {
    const { clientA, dbA, dbB } = harness
    const shopId = uuid(220)
    const profileId = uuid(221)
    const customerId = uuid(222)
    const vehicleId = uuid(223)
    await dbA.insert(shops).values({ id: shopId, name: 'Identity drift PostgreSQL' })
    const [profile] = await dbA.insert(profiles).values({
      id: profileId,
      userId: uuid(321),
      shopId,
      role: 'owner',
      skillTier: 3,
    }).returning()
    const actor: TicketActor = {
      profileId,
      shopId,
      role: profile.role,
      skillTier: profile.skillTier,
      membershipStatus: profile.membershipStatus,
      deactivatedAt: profile.deactivatedAt,
    }
    const body = {
      vehicleMode: 'new' as const,
      customer: { name: 'Identity Winner', phone: '555-0220' },
      vehicle: {
        year: 2020,
        make: 'Honda',
        model: 'Civic',
        vin: '2HGFC2F59LH102220',
        mileage: 42_000,
        plate: 'PG220',
      },
      clientKey: uuid(224),
      quote: { mode: 'manual' as const, kind: 'repair' as const, description: 'Inspect concern' },
    }
    let shopLocked!: () => void
    let mutationStarted!: () => void
    const shopLockedPromise = new Promise<void>((resolveLocked) => { shopLocked = resolveLocked })
    const mutationStartedPromise = new Promise<void>((resolveStarted) => {
      mutationStarted = resolveStarted
    })
    const appearingIdentity = clientA.begin(async (tx) => {
      await tx`select id from shops where id = ${shopId}::uuid for update`
      shopLocked()
      await mutationStartedPromise
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100))
      await tx`
        insert into customers (id, shop_id, name, phone)
        values (${customerId}::uuid, ${shopId}::uuid, 'Identity Winner', '555-0220')
      `
      await tx`
        insert into vehicles (id, customer_id, year, make, model, vin, mileage, plate)
        values (${vehicleId}::uuid, ${customerId}::uuid, 2020, 'Honda', 'Civic',
          '2HGFC2F59LH102220', 42000, 'PG220')
      `
    })
    await shopLockedPromise
    const quick = (async () => {
      mutationStarted()
      return createQuickTicket(dbB, { actor, body }, {
        loadMutationKeyring: () => postgresMutationKeyring,
      })
    })()
    const settled = await Promise.allSettled([appearingIdentity, quick])
    for (const result of settled) {
      if (result.status === 'rejected') throw result.reason
    }
    if (settled[1].status !== 'fulfilled') throw new Error('identity race did not settle')
    expect(settled[1].value).toEqual({ ok: false, error: 'conflict', retryable: true })
    expect(await dbA.select().from(tickets).where(eq(tickets.shopId, shopId))).toEqual([])
    expect((await dbA.select().from(shops).where(eq(shops.id, shopId)))[0].nextTicketNumber)
      .toBe(1)
    const retried = await createQuickTicket(dbB, { actor, body }, {
      loadMutationKeyring: () => postgresMutationKeyring,
    })
    expect(retried).toMatchObject({
      ok: true,
      ticket: { customer: { id: customerId }, vehicle: { id: vehicleId } },
    })
    expect(await dbA.select().from(customers).where(eq(customers.shopId, shopId)))
      .toEqual([expect.objectContaining({ id: customerId })])
    expect(await dbA.select().from(vehicles).where(eq(vehicles.customerId, customerId)))
      .toEqual([expect.objectContaining({ id: vehicleId })])
  }, 30_000)

  it('serializes production Counter/Counter phone, VIN, plate, mileage, and insertion-intent races', async () => {
    const { dbA, dbB } = harness

    const actorFor = async (seed: number): Promise<TicketActor> => {
      const shopId = uuid(seed)
      await dbA.insert(shops).values({ id: shopId, name: `Counter race ${seed}` })
      const [profile] = await dbA.insert(profiles).values({
        id: uuid(seed + 1),
        userId: uuid(seed + 101),
        shopId,
        role: 'owner',
        skillTier: 3,
      }).returning()
      return {
        profileId: profile.id,
        shopId,
        role: profile.role,
        skillTier: profile.skillTier,
        membershipStatus: profile.membershipStatus,
        deactivatedAt: profile.deactivatedAt,
      }
    }

    const runNewIdentityRace = async (input: {
      seed: number
      naturalKey: 'vin' | 'plate'
    }) => {
      const actor = await actorFor(input.seed)
      const phone = `555-${input.seed}`
      const vin = input.naturalKey === 'vin'
        ? `1FTEW1EP5JFC1${input.seed.toString().padStart(4, '0')}`
        : null
      const plate = `CC${input.seed}`
      const winnerBody = {
        vehicleMode: 'new' as const,
        customer: { name: 'Counter winner', phone, email: 'winner@example.com' },
        vehicle: {
          year: 2020,
          make: 'Ford',
          model: 'F-150',
          engine: 'winner engine',
          vin,
          mileage: 51_000,
          plate,
        },
        concern: `Counter ${input.naturalKey} winner`,
        assignedTechId: null,
      }
      const retryBody = {
        ...winnerBody,
        customer: { ...winnerBody.customer, name: 'Counter retry', email: 'retry@example.com' },
        vehicle: { ...winnerBody.vehicle, engine: 'retry engine' },
        concern: `Counter ${input.naturalKey} retry`,
      }

      let retryPreflightCalls = 0
      let retryPreflightReady!: () => void
      let winnerIdentityWritten!: () => void
      let releaseWinner!: () => void
      const retryPreflightReadyPromise = new Promise<void>((resolveReady) => {
        retryPreflightReady = resolveReady
      })
      const winnerIdentityWrittenPromise = new Promise<void>((resolveWritten) => {
        winnerIdentityWritten = resolveWritten
      })
      const releaseWinnerPromise = new Promise<void>((resolveRelease) => {
        releaseWinner = resolveRelease
      })

      const winner = createCounterTicket(dbA, { actor, body: winnerBody }, {
        afterIdentityPreflight: async () => retryPreflightReadyPromise,
        afterCustomerInsert: async () => {
          winnerIdentityWritten()
          await releaseWinnerPromise
        },
      })
      const racedRetry = createCounterTicket(dbB, { actor, body: retryBody }, {
        afterIdentityPreflight: async () => {
          retryPreflightCalls += 1
          if (retryPreflightCalls !== 1) return
          retryPreflightReady()
          await winnerIdentityWrittenPromise
        },
      })

      const racedResult = await racedRetry
      expect(racedResult).toEqual({ ok: false, error: 'conflict', retryable: true })
      expect(retryPreflightCalls).toBe(2)
      releaseWinner()
      const winnerResult = await winner
      expect(winnerResult).toMatchObject({ ok: true })
      const freshRetry = await createCounterTicket(dbB, { actor, body: retryBody })
      expect(freshRetry).toMatchObject({ ok: true })
      if (!winnerResult.ok || !freshRetry.ok) throw new Error('Counter identity race failed')

      const storedCustomers = await dbA.select().from(customers)
        .where(eq(customers.shopId, actor.shopId!))
      expect(storedCustomers).toEqual([expect.objectContaining({
        id: winnerResult.ticket.customer!.id,
        name: 'Counter winner',
        phone,
        email: 'winner@example.com',
      })])
      const storedVehicles = await dbA.select().from(vehicles)
        .where(eq(vehicles.customerId, storedCustomers[0]!.id))
      expect(storedVehicles).toEqual([expect.objectContaining({
        id: winnerResult.ticket.vehicle!.id,
        engine: 'winner engine',
        vin,
        mileage: 51_000,
        plate,
      })])
      expect(freshRetry.ticket.customer?.id).toBe(storedCustomers[0]!.id)
      expect(freshRetry.ticket.vehicle?.id).toBe(storedVehicles[0]!.id)
      const storedTickets = await dbA.select().from(tickets)
        .where(eq(tickets.shopId, actor.shopId!))
      const storedJobs = await dbA.select().from(ticketJobs)
        .where(eq(ticketJobs.shopId, actor.shopId!))
      expect(storedTickets).toHaveLength(2)
      expect(storedTickets.every((ticket) =>
        ticket.customerId === storedCustomers[0]!.id &&
        ticket.vehicleId === storedVehicles[0]!.id &&
        ticket.source === 'counter' &&
        ticket.projectionRevision === 1n &&
        ticket.continuityRevision === 1n,
      )).toBe(true)
      expect(storedJobs).toHaveLength(2)
      expect(new Set(storedJobs.map(({ ticketId }) => ticketId))).toEqual(
        new Set(storedTickets.map(({ id }) => id)),
      )
      expect(storedJobs.every(({ revision }) => revision === 1n)).toBe(true)
      expect((await dbA.select().from(shops).where(eq(shops.id, actor.shopId!)))[0])
        .toMatchObject({ nextTicketNumber: 3 })
    }

    await runNewIdentityRace({ seed: 600, naturalKey: 'vin' })
    await runNewIdentityRace({ seed: 610, naturalKey: 'plate' })

    const actor = await actorFor(620)
    const [customer] = await dbA.insert(customers).values({
      id: uuid(622),
      shopId: actor.shopId!,
      name: 'Existing mileage owner',
      phone: '555-0620',
      email: 'existing@example.com',
    }).returning()
    const [vehicle] = await dbA.insert(vehicles).values({
      id: uuid(623),
      customerId: customer.id,
      year: 2021,
      make: 'Honda',
      model: 'Accord',
      engine: '2.0T preserved',
      vin: '1HGCV2F39MA106200',
      mileage: 70_000,
      plate: 'CC620',
    }).returning()
    const bodyForMileage = (mileage: number, concern: string) => ({
      vehicleMode: 'existing' as const,
      existingVehicleId: vehicle.id,
      mileage,
      concern,
      assignedTechId: null,
    })
    let retryPreflightCalls = 0
    let retryPreflightReady!: () => void
    let mileageWritten!: () => void
    let releaseWinner!: () => void
    const retryPreflightReadyPromise = new Promise<void>((resolveReady) => {
      retryPreflightReady = resolveReady
    })
    const mileageWrittenPromise = new Promise<void>((resolveWritten) => {
      mileageWritten = resolveWritten
    })
    const releaseWinnerPromise = new Promise<void>((resolveRelease) => {
      releaseWinner = resolveRelease
    })
    const winner = createCounterTicket(dbA, {
      actor,
      body: bodyForMileage(71_000, 'First mileage'),
    }, {
      afterIdentityPreflight: async () => retryPreflightReadyPromise,
      afterMileageWrite: async () => {
        mileageWritten()
        await releaseWinnerPromise
      },
    })
    const racedRetry = createCounterTicket(dbB, {
      actor,
      body: bodyForMileage(72_000, 'Second mileage'),
    }, {
      afterIdentityPreflight: async () => {
        retryPreflightCalls += 1
        if (retryPreflightCalls !== 1) return
        retryPreflightReady()
        await mileageWrittenPromise
      },
    })
    await expect(racedRetry).resolves.toEqual({
      ok: false,
      error: 'conflict',
      retryable: true,
    })
    expect(retryPreflightCalls).toBe(2)
    releaseWinner()
    await expect(winner).resolves.toMatchObject({ ok: true })
    await expect(createCounterTicket(dbB, {
      actor,
      body: bodyForMileage(72_000, 'Second mileage'),
    })).resolves.toMatchObject({ ok: true })
    expect((await dbA.select().from(customers).where(eq(customers.id, customer.id)))[0])
      .toMatchObject({ name: 'Existing mileage owner', email: 'existing@example.com' })
    expect((await dbA.select().from(vehicles).where(eq(vehicles.id, vehicle.id)))[0])
      .toMatchObject({ engine: '2.0T preserved', mileage: 72_000, plate: 'CC620' })
    expect(await dbA.select().from(customers).where(eq(customers.shopId, actor.shopId!)))
      .toHaveLength(1)
    expect(await dbA.select().from(vehicles).where(eq(vehicles.customerId, customer.id)))
      .toHaveLength(1)
    expect(await dbA.select().from(tickets).where(eq(tickets.shopId, actor.shopId!)))
      .toHaveLength(2)
    expect(await dbA.select().from(ticketJobs).where(eq(ticketJobs.shopId, actor.shopId!)))
      .toHaveLength(2)
  }, 60_000)

  it('serializes production Counter/Quick phone, VIN, plate, mileage, and insertion-intent races', async () => {
    const { dbA, dbB } = harness

    const actorFor = async (seed: number): Promise<TicketActor> => {
      const shopId = uuid(seed)
      await dbA.insert(shops).values({ id: shopId, name: `Counter Quick race ${seed}` })
      const [profile] = await dbA.insert(profiles).values({
        id: uuid(seed + 1),
        userId: uuid(seed + 101),
        shopId,
        role: 'owner',
        skillTier: 3,
      }).returning()
      return {
        profileId: profile.id,
        shopId,
        role: profile.role,
        skillTier: profile.skillTier,
        membershipStatus: profile.membershipStatus,
        deactivatedAt: profile.deactivatedAt,
      }
    }

    const runNewIdentityRace = async (input: {
      seed: number
      naturalKey: 'vin' | 'plate'
    }) => {
      const actor = await actorFor(input.seed)
      const phone = `555-${input.seed}`
      const vin = input.naturalKey === 'vin'
        ? `1FTEW1EP5JFC1${input.seed.toString().padStart(4, '0')}`
        : null
      const plate = `CQ${input.seed}`
      const quickBody = {
        vehicleMode: 'new' as const,
        customer: { name: 'Quick winner', phone, email: 'quick@example.com' },
        vehicle: {
          year: 2022,
          make: 'Toyota',
          model: 'Tacoma',
          engine: 'quick engine',
          vin,
          mileage: 61_000,
          plate,
        },
        clientKey: uuid(input.seed + 2),
        quote: {
          mode: 'manual' as const,
          kind: 'repair' as const,
          description: `Quick ${input.naturalKey} winner`,
        },
      }
      const counterBody = {
        vehicleMode: 'new' as const,
        customer: { name: 'Counter retry', phone, email: 'counter@example.com' },
        vehicle: { ...quickBody.vehicle, engine: 'counter engine' },
        concern: `Counter ${input.naturalKey} retry`,
        assignedTechId: null,
      }
      let counterPreflightCalls = 0
      let counterPreflightReady!: () => void
      let quickIdentityWritten!: () => void
      let releaseQuick!: () => void
      const counterPreflightReadyPromise = new Promise<void>((resolveReady) => {
        counterPreflightReady = resolveReady
      })
      const quickIdentityWrittenPromise = new Promise<void>((resolveWritten) => {
        quickIdentityWritten = resolveWritten
      })
      const releaseQuickPromise = new Promise<void>((resolveRelease) => {
        releaseQuick = resolveRelease
      })
      const racedCounter = createCounterTicket(dbA, { actor, body: counterBody }, {
        afterIdentityPreflight: async () => {
          counterPreflightCalls += 1
          if (counterPreflightCalls !== 1) return
          counterPreflightReady()
          await quickIdentityWrittenPromise
        },
      })
      await counterPreflightReadyPromise
      const quick = createQuickTicket(dbB, { actor, body: quickBody }, {
        loadMutationKeyring: () => postgresMutationKeyring,
        afterCustomer: async () => {
          quickIdentityWritten()
          await releaseQuickPromise
        },
      })
      const racedCounterResult = await racedCounter
      expect(racedCounterResult).toEqual({ ok: false, error: 'conflict', retryable: true })
      expect(counterPreflightCalls).toBe(2)
      releaseQuick()
      const quickResult = await quick
      expect(quickResult).toMatchObject({ ok: true })
      const freshCounter = await createCounterTicket(dbA, { actor, body: counterBody })
      expect(freshCounter).toMatchObject({ ok: true })
      if (!quickResult.ok || !freshCounter.ok) throw new Error('Counter Quick identity race failed')

      const storedCustomers = await dbA.select().from(customers)
        .where(eq(customers.shopId, actor.shopId!))
      expect(storedCustomers).toEqual([expect.objectContaining({
        id: quickResult.ticket.customer!.id,
        name: 'Quick winner',
        phone,
        email: 'quick@example.com',
      })])
      const storedVehicles = await dbA.select().from(vehicles)
        .where(eq(vehicles.customerId, storedCustomers[0]!.id))
      expect(storedVehicles).toEqual([expect.objectContaining({
        id: quickResult.ticket.vehicle!.id,
        engine: 'quick engine',
        vin,
        mileage: 61_000,
        plate,
      })])
      expect(freshCounter.ticket.customer?.id).toBe(storedCustomers[0]!.id)
      expect(freshCounter.ticket.vehicle?.id).toBe(storedVehicles[0]!.id)
      const storedTickets = await dbA.select().from(tickets)
        .where(eq(tickets.shopId, actor.shopId!))
      const storedJobs = await dbA.select().from(ticketJobs)
        .where(eq(ticketJobs.shopId, actor.shopId!))
      expect(storedTickets).toHaveLength(2)
      expect(storedTickets.map(({ source }) => source).sort()).toEqual(['counter', 'quick_quote'])
      expect(storedTickets.every((ticket) =>
        ticket.customerId === storedCustomers[0]!.id &&
        ticket.vehicleId === storedVehicles[0]!.id &&
        ticket.projectionRevision === 1n &&
        ticket.continuityRevision === 1n,
      )).toBe(true)
      expect(storedJobs).toHaveLength(2)
      expect(new Set(storedJobs.map(({ ticketId }) => ticketId))).toEqual(
        new Set(storedTickets.map(({ id }) => id)),
      )
      expect(storedJobs.every(({ revision }) => revision === 1n)).toBe(true)
      expect((await dbA.select().from(shops).where(eq(shops.id, actor.shopId!)))[0])
        .toMatchObject({ nextTicketNumber: 3 })
    }

    await runNewIdentityRace({ seed: 630, naturalKey: 'vin' })
    await runNewIdentityRace({ seed: 640, naturalKey: 'plate' })

    const actor = await actorFor(650)
    const [customer] = await dbA.insert(customers).values({
      id: uuid(652),
      shopId: actor.shopId!,
      name: 'Counter Quick mileage owner',
      phone: '555-0650',
      email: 'cq-existing@example.com',
    }).returning()
    const [vehicle] = await dbA.insert(vehicles).values({
      id: uuid(653),
      customerId: customer.id,
      year: 2023,
      make: 'Subaru',
      model: 'Outback',
      engine: '2.4T preserved',
      vin: '4S4BTGPD9P3165000',
      mileage: 80_000,
      plate: 'CQ650',
    }).returning()
    const counterBody = {
      vehicleMode: 'existing' as const,
      existingVehicleId: vehicle.id,
      mileage: 82_000,
      concern: 'Counter mileage retry',
      assignedTechId: null,
    }
    const quickBody = {
      vehicleMode: 'existing' as const,
      existingVehicleId: vehicle.id,
      mileage: 81_000,
      clientKey: uuid(654),
      quote: {
        mode: 'manual' as const,
        kind: 'maintenance' as const,
        description: 'Quick mileage winner',
      },
    }
    let counterPreflightCalls = 0
    let counterPreflightReady!: () => void
    let quickMileageWritten!: () => void
    let releaseQuick!: () => void
    const counterPreflightReadyPromise = new Promise<void>((resolveReady) => {
      counterPreflightReady = resolveReady
    })
    const quickMileageWrittenPromise = new Promise<void>((resolveWritten) => {
      quickMileageWritten = resolveWritten
    })
    const releaseQuickPromise = new Promise<void>((resolveRelease) => {
      releaseQuick = resolveRelease
    })
    const racedCounter = createCounterTicket(dbA, { actor, body: counterBody }, {
      afterIdentityPreflight: async () => {
        counterPreflightCalls += 1
        if (counterPreflightCalls !== 1) return
        counterPreflightReady()
        await quickMileageWrittenPromise
      },
    })
    await counterPreflightReadyPromise
    const quick = createQuickTicket(dbB, { actor, body: quickBody }, {
      loadMutationKeyring: () => postgresMutationKeyring,
      afterMileage: async () => {
        quickMileageWritten()
        await releaseQuickPromise
      },
    })
    await expect(racedCounter).resolves.toEqual({
      ok: false,
      error: 'conflict',
      retryable: true,
    })
    expect(counterPreflightCalls).toBe(2)
    releaseQuick()
    await expect(quick).resolves.toMatchObject({ ok: true })
    await expect(createCounterTicket(dbA, { actor, body: counterBody }))
      .resolves.toMatchObject({ ok: true })
    expect((await dbA.select().from(customers).where(eq(customers.id, customer.id)))[0])
      .toMatchObject({ name: 'Counter Quick mileage owner', email: 'cq-existing@example.com' })
    expect((await dbA.select().from(vehicles).where(eq(vehicles.id, vehicle.id)))[0])
      .toMatchObject({ engine: '2.4T preserved', mileage: 82_000, plate: 'CQ650' })
    expect(await dbA.select().from(customers).where(eq(customers.shopId, actor.shopId!)))
      .toHaveLength(1)
    expect(await dbA.select().from(vehicles).where(eq(vehicles.customerId, customer.id)))
      .toHaveLength(1)
    const storedTickets = await dbA.select().from(tickets)
      .where(eq(tickets.shopId, actor.shopId!))
    expect(storedTickets).toHaveLength(2)
    expect(storedTickets.map(({ source }) => source).sort()).toEqual(['counter', 'quick_quote'])
    expect(await dbA.select().from(ticketJobs).where(eq(ticketJobs.shopId, actor.shopId!)))
      .toHaveLength(2)
  }, 60_000)

  it('serializes two production claimers and returns only the persisted safe assignee', async () => {
    const { dbA, dbB } = harness
    const shopId = uuid(230)
    const firstTechId = uuid(231)
    const secondTechId = uuid(232)
    const ticketId = uuid(233)
    const jobId = uuid(234)
    await dbA.insert(shops).values({ id: shopId, name: 'Assignment race PostgreSQL' })
    await dbA.insert(profiles).values([
      {
        id: firstTechId,
        userId: uuid(331),
        shopId,
        fullName: 'Taylor Tech',
        role: 'tech',
        skillTier: 2,
      },
      {
        id: secondTechId,
        userId: uuid(332),
        shopId,
        fullName: 'Terry Tech',
        role: 'tech',
        skillTier: 2,
      },
    ])
    await dbA.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 1,
      source: 'tech_quick',
      concern: 'Two-actor assignment race',
      createdByProfileId: firstTechId,
    })
    await dbA.insert(ticketJobs).values({
      id: jobId,
      shopId,
      ticketId,
      title: 'Inspect concern',
      kind: 'diagnostic',
      requiredSkillTier: 1,
    })
    const actorFor = (profileId: string): TicketActor => ({
      profileId,
      shopId,
      role: 'tech',
      skillTier: 2,
      membershipStatus: 'active',
      deactivatedAt: null,
    })
    const claim = (db: PostgresContinuityHarness['dbA'], profileId: string) =>
      mutateTicketJobAssignment(db, {
        actor: actorFor(profileId),
        ticketId,
        jobId,
        body: { action: 'claim' },
      })
    const raced = await Promise.all([
      claim(dbA, firstTechId),
      claim(dbB, secondTechId),
    ])
    const winner = raced.find((result) => result.ok)
    expect(winner).toMatchObject({ ok: true })
    const [storedJob] = await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    const losingProfileId = storedJob.assignedTechId === firstTechId ? secondTechId : firstTechId
    const loser = raced.find((result) => !result.ok)?.error === 'assignment_conflict'
      ? raced.find((result) => !result.ok)!
      : await claim(dbB, losingProfileId)
    expect(loser).toEqual({
      ok: false,
      error: 'assignment_conflict',
      currentAssignee: {
        id: storedJob.assignedTechId,
        fullName: storedJob.assignedTechId === firstTechId ? 'Taylor Tech' : 'Terry Tech',
        role: 'tech',
        skillTier: 2,
      },
    })
    expect(storedJob.revision).toBe(1n)
    expect((await dbA.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toMatchObject({ projectionRevision: 1n, continuityRevision: 0n })
  }, 20_000)

  it('serializes production add-job versus quote-version creation on one PostgreSQL ticket', async () => {
    const { dbA, dbB } = harness
    const shopId = uuid(240)
    const profileId = uuid(241)
    const customerId = uuid(242)
    const vehicleId = uuid(243)
    const ticketId = uuid(244)
    const jobId = uuid(245)
    await dbA.insert(shops).values({
      id: shopId,
      name: 'Add versus quote PostgreSQL',
      laborRateCents: 15_000,
      taxRateBps: 825,
    })
    const [profile] = await dbA.insert(profiles).values({
      id: profileId,
      userId: uuid(341),
      shopId,
      role: 'owner',
      skillTier: 3,
    }).returning()
    await dbA.insert(customers).values({
      id: customerId,
      shopId,
      name: 'Quote Customer',
      phone: '555-0240',
    })
    await dbA.insert(vehicles).values({
      id: vehicleId,
      customerId,
      year: 2020,
      make: 'Ford',
      model: 'F-150',
    })
    await dbA.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 1,
      source: 'counter',
      customerId,
      vehicleId,
      concern: 'Brake noise',
      createdByProfileId: profileId,
    })
    await dbA.insert(ticketJobs).values({
      id: jobId,
      shopId,
      ticketId,
      title: 'Front brakes',
      kind: 'repair',
      requiredSkillTier: 1,
    })
    await dbA.insert(jobLines).values({
      id: uuid(246),
      shopId,
      jobId,
      kind: 'fee',
      description: 'Inspection',
      sort: 1,
      priceCents: 500,
      taxable: true,
    })
    const actor: TicketActor = {
      profileId,
      shopId,
      role: profile.role,
      skillTier: profile.skillTier,
      membershipStatus: profile.membershipStatus,
      deactivatedAt: profile.deactivatedAt,
    }
    const add = (db: PostgresContinuityHarness['dbA']) => addTicketJob(db, {
      actor,
      ticketId,
      body: {
        title: 'Alignment check',
        kind: 'maintenance',
        requiredSkillTier: 1,
      },
    })
    const version = (db: PostgresContinuityHarness['dbA']) =>
      createQuoteVersion(db, { actor: { profileId }, ticketId })
    const raced = await Promise.all([add(dbA), version(dbB)])
    const added = raced[0].ok ? raced[0] : await add(dbA)
    const quoted = raced[1].ok ? raced[1] : await version(dbB)
    expect(added).toMatchObject({ ok: true })
    expect(quoted).toMatchObject({ ok: true })
    const jobs = await dbA.select().from(ticketJobs).where(eq(ticketJobs.ticketId, ticketId))
    expect(jobs).toHaveLength(2)
    expect(await dbA.select().from(quoteVersions).where(eq(quoteVersions.ticketId, ticketId)))
      .toHaveLength(1)
    expect((await dbA.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toMatchObject({ projectionRevision: 2n, continuityRevision: 2n })
  }, 20_000)

  it('serializes reviewed story save versus line edit and one active quote invalidation', async () => {
    const { dbA, dbB } = harness
    const shopId = uuid(250)
    const techId = uuid(251)
    const ownerId = uuid(252)
    const customerId = uuid(253)
    const vehicleId = uuid(254)
    const ticketId = uuid(255)
    const sessionId = uuid(256)
    const jobId = uuid(257)
    const eventId = uuid(258)
    const lineId = uuid(259)
    await dbA.insert(shops).values({
      id: shopId,
      name: 'Story line race PostgreSQL',
      laborRateCents: 15_000,
      taxRateBps: 825,
    })
    await dbA.insert(profiles).values([
      { id: techId, userId: uuid(351), shopId, role: 'tech', skillTier: 2 },
      { id: ownerId, userId: uuid(352), shopId, role: 'owner', skillTier: 3 },
    ])
    await dbA.insert(customers).values({
      id: customerId,
      shopId,
      name: 'Story Customer',
      phone: '555-0250',
    })
    await dbA.insert(vehicles).values({
      id: vehicleId,
      customerId,
      year: 2020,
      make: 'Ford',
      model: 'F-150',
    })
    await dbA.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 1,
      source: 'counter',
      customerId,
      vehicleId,
      concern: 'Battery warning under load',
      createdByProfileId: ownerId,
    })
    await dbA.insert(sessions).values({
      id: sessionId,
      shopId,
      techId,
      vehicleId,
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Ford',
        vehicleModel: 'F-150',
        customerComplaint: 'Battery warning under load',
      },
      treeState: {
        nodes: [{ id: 'root', label: 'Charging test', status: 'resolved' }],
        currentNodeId: 'root',
        message: 'Diagnosis locked.',
        done: true,
        phase: 'repairing',
        diagnosisLockedAt: '2026-07-17T12:00:00.000Z',
        rootCauseSummary: 'Alternator output is below specification under load.',
        proposedAction: { description: 'Replace the alternator.', confidence: 0.94 },
      },
    })
    const story = {
      whatYouToldUs: 'Battery warning under load',
      whatWeFound: 'Alternator output is below specification.',
      howWeKnow: [{
        claim: 'Charging voltage dropped under load.',
        sourceEventIds: [eventId],
        sourceArtifactIds: [],
      }],
      whatItMeansIfWaived: 'If you choose not to proceed, the diagnosed issue remains unresolved.',
      whatWeRecommend: 'Replace the alternator.',
    }
    await dbA.insert(ticketJobs).values({
      id: jobId,
      shopId,
      ticketId,
      title: 'Charging diagnosis',
      kind: 'diagnostic',
      requiredSkillTier: 2,
      assignedTechId: techId,
      sessionId,
      workStatus: 'in_progress',
      customerStory: story,
      storyMeta: {
        source: 'ai',
        sessionId,
        generatedAt: '2026-07-17T12:01:00.000Z',
        lastEditedByProfileId: techId,
        lastEditedAt: '2026-07-17T12:01:00.000Z',
        generationClientKey: uuid(261),
        generationRequestFingerprint: 'a'.repeat(64),
        generatedByProfileId: techId,
        storyRevision: 1,
        reviewStatus: 'pending',
      },
    })
    await dbA.insert(sessionEvents).values({
      id: eventId,
      sessionId,
      nodeId: 'root',
      eventType: 'observation',
      observationText: 'Charging voltage dropped under load.',
      createdAt: new Date('2026-07-17T11:59:00.000Z'),
    })
    await dbA.insert(jobLines).values({
      id: lineId,
      shopId,
      jobId,
      kind: 'part',
      description: 'Alternator',
      quantity: 1,
      priceCents: 30_000,
      taxable: true,
    })
    const firstReviewInput = {
      actor: { profileId: techId },
      ticketId,
      jobId,
      clientKey: uuid(262),
      expectedStoryRevision: 1,
      whatWeFound: 'The alternator cannot maintain charging voltage under load.',
      whatWeRecommend: 'Replace the alternator and verify charging output.',
    }
    const firstReview = await saveReviewedCustomerStory(dbA, firstReviewInput)
    expect(firstReview).toMatchObject({ ok: true, changed: true, storyRevision: 2 })
    expect((await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
      .toMatchObject({ revision: 1n })
    expect((await dbA.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toMatchObject({ projectionRevision: 1n, continuityRevision: 0n })

    const seededVersion = await createQuoteVersion(dbA, {
      actor: { profileId: ownerId },
      ticketId,
    })
    if (!seededVersion.ok) throw new Error('story race quote fixture failed')
    expect(seededVersion.version).toMatchObject({ versionNumber: 1 })
    expect((await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
      .toMatchObject({ approvalState: 'quote_ready', revision: 2n })
    expect((await dbA.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toMatchObject({ projectionRevision: 2n, continuityRevision: 1n })

    const secondReviewInput = {
      ...firstReviewInput,
      clientKey: uuid(263),
      expectedStoryRevision: 2,
      whatWeFound: 'The alternator fails its loaded charging-output specification.',
      whatWeRecommend: 'Replace the alternator, then retest output under load.',
    }
    const lineInput = {
      actor: { profileId: techId },
      ticketId,
      jobId,
      lineId,
      body: {
        kind: 'part',
        description: 'Updated alternator',
        quantity: '1',
        priceCents: 31_000,
        taxable: true,
        partNumber: 'ALT-1',
        brand: 'ACME',
        unitCostCents: 20_000,
        coreChargeCents: 0,
        fitment: 'Direct fit',
      },
    }
    const review = (db: PostgresContinuityHarness['dbA']) =>
      saveReviewedCustomerStory(db, secondReviewInput)
    const replace = (db: PostgresContinuityHarness['dbA']) => replaceDraftLine(db, lineInput)
    const raced = await Promise.all([review(dbA), replace(dbB)])
    expect(raced[0].ok ? raced[0] : raced[0]).toSatisfy((result) =>
      result.ok || (
        result.error === 'conflict' && result.retryable === true
      ))
    expect(raced[1].ok ? raced[1] : raced[1]).toSatisfy((result) =>
      result.ok || (
        result.error === 'conflict' && result.retryable === true
      ))
    const reviewed = raced[0].ok ? raced[0] : await review(dbA)
    const replaced = raced[1].ok ? raced[1] : await replace(dbB)
    expect(reviewed).toMatchObject({ ok: true })
    expect(replaced).toMatchObject({ ok: true })
    const [storedJob] = await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(storedJob).toMatchObject({
      customerStory: { whatWeFound: secondReviewInput.whatWeFound },
      storyMeta: { storyRevision: 3 },
      approvalState: 'pending_quote',
      approvedQuoteVersionId: null,
      revision: 4n,
    })
    expect((await dbA.select().from(jobLines).where(eq(jobLines.id, lineId)))[0])
      .toMatchObject({ description: 'Updated alternator', priceCents: 31_000 })
    const storedVersions = await dbA.select().from(quoteVersions)
      .where(eq(quoteVersions.ticketId, ticketId))
    expect(storedVersions).toHaveLength(1)
    expect(storedVersions[0].id).toBe(seededVersion.version.id)
    expect(storedVersions[0].supersededAt).not.toBeNull()
    expect((await dbA.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toMatchObject({ projectionRevision: 4n, continuityRevision: 2n })
  }, 30_000)

  it('serializes diagnostic finalize versus assignment on a sibling job', async () => {
    const { dbA, dbB } = harness
    const shopId = uuid(400)
    const techId = uuid(401)
    const siblingTechId = uuid(402)
    const ownerId = uuid(403)
    const customerId = uuid(404)
    const vehicleId = uuid(405)
    const ticketId = uuid(406)
    const diagnosticJobId = uuid(407)
    const siblingJobId = uuid(408)
    const attemptKey = uuid(409)
    const sessionId = uuid(410)
    await dbA.insert(shops).values({ id: shopId, name: 'Diagnostic assignment race' })
    await dbA.insert(profiles).values([
      { id: techId, userId: uuid(501), shopId, role: 'tech', skillTier: 2 },
      { id: siblingTechId, userId: uuid(502), shopId, role: 'tech', skillTier: 3 },
      { id: ownerId, userId: uuid(503), shopId, role: 'owner', skillTier: 3 },
    ])
    await dbA.insert(customers).values({
      id: customerId, shopId, name: 'Diagnostic Customer', phone: '555-0400',
    })
    await dbA.insert(vehicles).values({
      id: vehicleId,
      customerId,
      year: 2018,
      make: 'Ford',
      model: 'F-150',
      engine: '3.5L EcoBoost',
      mileage: 84_000,
    })
    await dbA.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 1,
      source: 'counter',
      customerId,
      vehicleId,
      concern: 'Intermittent no-start after heat soak',
      createdByProfileId: ownerId,
    })
    await dbA.insert(ticketJobs).values([
      {
        id: diagnosticJobId,
        shopId,
        ticketId,
        title: 'Diagnose no-start',
        kind: 'diagnostic',
        requiredSkillTier: 2,
        assignedTechId: techId,
      },
      {
        id: siblingJobId,
        shopId,
        ticketId,
        title: 'Inspect battery cables',
        kind: 'repair',
        requiredSkillTier: 1,
      },
    ])
    const diagnosticActor = { profileId: techId, shopId }
    const acquired = await acquireDiagnosticStart(dbA, {
      actor: diagnosticActor,
      ticketId,
      jobId: diagnosticJobId,
      attemptKey,
    })
    if (!acquired.ok || acquired.state !== 'initializing' || !acquired.leaseAcquired) {
      throw new Error('diagnostic assignment race lease fixture failed')
    }
    let finalizeLocked!: () => void
    let releaseFinalize!: () => void
    const finalizeLockedPromise = new Promise<void>((resolveLocked) => {
      finalizeLocked = resolveLocked
    })
    const releaseFinalizePromise = new Promise<void>((resolveRelease) => {
      releaseFinalize = resolveRelease
    })
    const finalized = finalizeDiagnosticStart(dbA, {
      actor: diagnosticActor,
      ticketId,
      jobId: diagnosticJobId,
      attemptKey,
      sessionId,
      context: acquired.context,
      treeState: {
        nodes: [{ id: 'root', label: 'Verify the concern', status: 'active' }],
        currentNodeId: 'root',
        message: 'Begin with a visual inspection.',
      },
    }, {
      afterLocks: async () => {
        finalizeLocked()
        await releaseFinalizePromise
      },
    })
    await finalizeLockedPromise
    const assigned = mutateTicketJobAssignment(dbB, {
      actor: {
        profileId: ownerId,
        shopId,
        role: 'owner',
        skillTier: 3,
        membershipStatus: 'active',
        deactivatedAt: null,
      },
      ticketId,
      jobId: siblingJobId,
      body: { action: 'reassign', assignedTechId: siblingTechId, confirmBelowTier: false },
    })
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    releaseFinalize()
    const [finalizeResult, assignmentResult] = await Promise.all([finalized, assigned])
    expect(finalizeResult).toEqual({ ok: true, state: 'ready', sessionId })
    const completedAssignment = assignmentResult.ok
      ? assignmentResult
      : await mutateTicketJobAssignment(dbB, {
          actor: {
            profileId: ownerId,
            shopId,
            role: 'owner',
            skillTier: 3,
            membershipStatus: 'active',
            deactivatedAt: null,
          },
          ticketId,
          jobId: siblingJobId,
          body: {
            action: 'reassign',
            assignedTechId: siblingTechId,
            confirmBelowTier: false,
          },
        })
    if (!assignmentResult.ok) {
      expect(assignmentResult).toEqual({ ok: false, error: 'conflict', retryable: true })
    }
    expect(completedAssignment).toMatchObject({ ok: true })
    expect((await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, diagnosticJobId)))[0])
      .toMatchObject({ sessionId, workStatus: 'in_progress', revision: 2n })
    expect((await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, siblingJobId)))[0])
      .toMatchObject({ assignedTechId: siblingTechId, revision: 1n })
    expect((await dbA.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toMatchObject({ projectionRevision: 3n, continuityRevision: 1n })
    expect(await dbA.select().from(sessions).where(eq(sessions.id, sessionId))).toHaveLength(1)
  }, 30_000)

  it('serializes simple-work completion versus ticketed diagnostic close on sibling jobs', async () => {
    const { clientA, dbA, dbB } = harness
    const shopId = uuid(420)
    const techId = uuid(421)
    const techUserId = uuid(521)
    const advisorId = uuid(422)
    const customerId = uuid(423)
    const vehicleId = uuid(424)
    const ticketId = uuid(425)
    const simpleJobId = uuid(426)
    const diagnosticJobId = uuid(427)
    const simpleLineId = uuid(428)
    const diagnosticLineId = uuid(429)
    const sessionId = uuid(430)
    const versionId = uuid(431)
    await dbA.insert(shops).values({
      id: shopId, name: 'Simple close race', laborRateCents: 15_000, taxRateBps: 825,
    })
    await dbA.insert(profiles).values([
      { id: techId, userId: techUserId, shopId, role: 'tech', skillTier: 3 },
      { id: advisorId, userId: uuid(522), shopId, role: 'advisor', skillTier: 3 },
    ])
    await dbA.insert(customers).values({
      id: customerId, shopId, name: 'Simple Customer', phone: '555-0420',
    })
    await dbA.insert(vehicles).values({
      id: vehicleId, customerId, year: 2020, make: 'Jeep', model: 'Wrangler',
    })
    await dbA.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 1,
      source: 'counter',
      customerId,
      vehicleId,
      concern: 'Install lift kit and diagnose warning',
      createdByProfileId: advisorId,
    })
    await dbA.insert(sessions).values({
      id: sessionId,
      shopId,
      techId,
      vehicleId,
      intake: {
        vehicleYear: 2020,
        vehicleMake: 'Jeep',
        vehicleModel: 'Wrangler',
        customerComplaint: 'Warning under load',
      },
      treeState: {
        nodes: [{ id: 'root', label: 'Confirm warning', status: 'resolved' }],
        currentNodeId: 'root',
        message: 'Diagnosis locked.',
        phase: 'repairing',
        done: true,
        diagnosisLockedAt: '2026-07-17T12:00:00.000Z',
        rootCauseSummary: 'Charging output falls below specification under load.',
      },
    })
    await dbA.insert(ticketJobs).values([
      {
        id: simpleJobId,
        shopId,
        ticketId,
        title: 'Install lift kit',
        kind: 'repair',
        requiredSkillTier: 2,
        assignedTechId: techId,
      },
      {
        id: diagnosticJobId,
        shopId,
        ticketId,
        title: 'Diagnose warning',
        kind: 'diagnostic',
        requiredSkillTier: 3,
        assignedTechId: techId,
        sessionId,
        workStatus: 'in_progress',
      },
    ])
    await dbA.insert(jobLines).values([
      {
        id: simpleLineId,
        shopId,
        jobId: simpleJobId,
        kind: 'labor',
        description: 'Install lift kit',
        priceCents: 60_000,
        taxable: false,
        laborHours: 4,
        laborRateCents: 15_000,
      },
      {
        id: diagnosticLineId,
        shopId,
        jobId: diagnosticJobId,
        kind: 'fee',
        description: 'Diagnostic evaluation',
        priceCents: 15_000,
        taxable: true,
      },
    ])
    const snapshotJob = (
      id: string,
      title: string,
      kind: 'repair' | 'diagnostic',
      line: { id: string; kind: 'labor' | 'fee'; description: string; priceCents: number; taxable: boolean },
    ) => ({
      id,
      title,
      kind,
      customerStory: null,
      storyMeta: null,
      lines: [{
        ...line,
        quantity: '1',
        partNumber: null,
        brand: null,
        coreChargeCents: null,
        fitment: null,
        laborHours: line.kind === 'labor' ? '4' : null,
        laborRateCents: line.kind === 'labor' ? 15_000 : null,
        source: 'manual',
        vendorContext: null,
      }],
      attachments: [],
      totals: { subtotalCents: line.priceCents, taxableSubtotalCents: line.taxable ? line.priceCents : 0 },
    })
    await dbA.insert(quoteVersions).values({
      id: versionId,
      shopId,
      ticketId,
      versionNumber: 1,
      createdByProfileId: advisorId,
      snapshot: {
        schemaVersion: 1,
        ticket: {
          id: ticketId,
          number: 1,
          customerId,
          vehicleId,
          laborRateCents: 15_000,
          taxRateBps: 825,
        },
        jobs: [
          snapshotJob(simpleJobId, 'Install lift kit', 'repair', {
            id: simpleLineId,
            kind: 'labor',
            description: 'Install lift kit',
            priceCents: 60_000,
            taxable: false,
          }),
          snapshotJob(diagnosticJobId, 'Diagnose warning', 'diagnostic', {
            id: diagnosticLineId,
            kind: 'fee',
            description: 'Diagnostic evaluation',
            priceCents: 15_000,
            taxable: true,
          }),
        ],
        totals: {
          subtotalCents: 75_000,
          taxableSubtotalCents: 15_000,
          taxCents: 1_238,
          totalCents: 76_238,
        },
      },
    })
    await dbA.update(ticketJobs).set({
      approvalState: 'approved',
      approvedQuoteVersionId: versionId,
    }).where(eq(ticketJobs.ticketId, ticketId))
    await dbA.insert(quoteEvents).values([
      {
        id: uuid(432), shopId, ticketId, jobId: simpleJobId, quoteVersionId: versionId,
        kind: 'approved', actorProfileId: advisorId, approvedVia: 'phone', requestKey: uuid(433),
      },
      {
        id: uuid(434), shopId, ticketId, jobId: diagnosticJobId, quoteVersionId: versionId,
        kind: 'approved', actorProfileId: advisorId, approvedVia: 'phone', requestKey: uuid(435),
      },
    ])
    const simpleActor = { profileId: techId, shopId }
    const started = await mutateSimpleWork(dbA, {
      actor: simpleActor,
      ticketId,
      jobId: simpleJobId,
      body: { action: 'start' },
    })
    if (!started.ok) throw new Error('simple close race start fixture failed')
    const noted = await mutateSimpleWork(dbA, {
      actor: simpleActor,
      ticketId,
      jobId: simpleJobId,
      body: {
        action: 'save_note',
        note: 'Installed and torqued to specification.',
        expectedUpdatedAt: started.work.updatedAt,
      },
    })
    if (!noted.ok) {
      const [persisted] = await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, simpleJobId))
      const [rawTimestamp] = await clientA<{ exactUpdatedAt: string }[]>`
        select to_char(updated_at, 'YYYY-MM-DD"T"HH24:MI:SS.USOF') as "exactUpdatedAt"
        from ticket_jobs where id = ${simpleJobId}::uuid
      `
      throw new Error(JSON.stringify({
        noted,
        returnedUpdatedAt: started.work.updatedAt,
        persistedUpdatedAt: persisted.updatedAt.toISOString(),
        exactUpdatedAt: rawTimestamp?.exactUpdatedAt,
      }))
    }
    let completeLocked!: () => void
    let releaseComplete!: () => void
    const completeLockedPromise = new Promise<void>((resolveLocked) => {
      completeLocked = resolveLocked
    })
    const releaseCompletePromise = new Promise<void>((resolveRelease) => {
      releaseComplete = resolveRelease
    })
    const completed = mutateSimpleWork(dbA, {
      actor: simpleActor,
      ticketId,
      jobId: simpleJobId,
      body: { action: 'complete', expectedUpdatedAt: noted.work.updatedAt },
    }, {
      afterLocks: async () => {
        completeLocked()
        await releaseCompletePromise
      },
    })
    await completeLockedPromise
    const close = () => closeSessionForUser({
      db: dbB,
      userId: techUserId,
      sessionId,
      body: {
        rootCause: 'Charging output falls below specification under load.',
        actionType: 'repair',
        verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' },
        diagMinutes: 45,
        repairMinutes: 60,
      },
      validateSpecificity: async () => ({ ok: true }),
    })
    const closed = close()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    releaseComplete()
    const [completeResult, racedCloseResult] = await Promise.all([completed, closed])
    expect(completeResult).toMatchObject({ ok: true, changed: true })
    const closeResult = racedCloseResult.ok ? racedCloseResult : await close()
    if (!racedCloseResult.ok) {
      expect(racedCloseResult).toEqual({
        ok: false,
        status: 409,
        error: 'conflict',
        retryable: true,
      })
    }
    expect(closeResult).toEqual({ ok: true })
    expect((await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, simpleJobId)))[0])
      .toMatchObject({ workStatus: 'done', revision: 3n })
    expect((await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, diagnosticJobId)))[0])
      .toMatchObject({ workStatus: 'done', revision: 1n })
    expect((await dbA.select().from(sessions).where(eq(sessions.id, sessionId)))[0].status)
      .toBe('closed')
    expect((await dbA.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toMatchObject({ projectionRevision: 4n, continuityRevision: 3n })
  }, 30_000)

  it('serializes manual-offer insert and delete versus quote-version creation', async () => {
    const { dbA, dbB } = harness
    const shopId = uuid(450)
    const profileId = uuid(451)
    const customerId = uuid(452)
    const vehicleId = uuid(453)
    const ticketId = uuid(454)
    const jobId = uuid(455)
    const baseLineId = uuid(456)
    const offerLineId = uuid(457)
    const vendorAccountId = uuid(458)
    await dbA.insert(shops).values({
      id: shopId, name: 'Manual offer quote race', laborRateCents: 15_000, taxRateBps: 825,
    })
    await dbA.insert(profiles).values({
      id: profileId, userId: uuid(551), shopId, role: 'owner', skillTier: 3,
    })
    await dbA.insert(customers).values({
      id: customerId, shopId, name: 'Offer Customer', phone: '555-0450',
    })
    await dbA.insert(vehicles).values({
      id: vehicleId, customerId, year: 2020, make: 'Ford', model: 'F-150',
    })
    await dbA.insert(tickets).values({
      id: ticketId,
      shopId,
      ticketNumber: 1,
      source: 'counter',
      customerId,
      vehicleId,
      concern: 'Brake noise',
      createdByProfileId: profileId,
    })
    await dbA.insert(ticketJobs).values({
      id: jobId,
      shopId,
      ticketId,
      title: 'Front brakes',
      kind: 'repair',
      requiredSkillTier: 1,
    })
    await dbA.insert(jobLines).values({
      id: baseLineId,
      shopId,
      jobId,
      kind: 'fee',
      description: 'Inspection',
      sort: 0,
      priceCents: 500,
      taxable: true,
    })
    await dbA.insert(vendorAccounts).values({
      id: vendorAccountId,
      shopId,
      vendor: 'manual',
      displayName: 'Local Parts',
      mode: 'manual',
      nonSecretConfig: {},
      secretRef: null,
      enabled: true,
    })
    const offerInput = {
      actor: { profileId },
      ticketId,
      jobId,
      body: {
        clientKey: offerLineId,
        vendorAccountId,
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
        externalOfferId: 'phone-quote-450',
      },
    }
    let captureLocked!: () => void
    let releaseCapture!: () => void
    const captureLockedPromise = new Promise<void>((resolveLocked) => {
      captureLocked = resolveLocked
    })
    const releaseCapturePromise = new Promise<void>((resolveRelease) => {
      releaseCapture = resolveRelease
    })
    const captured = captureManualOffer(dbA, offerInput, {
      afterDiscovery: async () => {
        captureLocked()
        await releaseCapturePromise
      },
    })
    await captureLockedPromise
    const createVersion = () => createQuoteVersion(dbB, { actor: { profileId }, ticketId })
    const firstVersion = createVersion()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    releaseCapture()
    const [captureResult, racedFirstVersion] = await Promise.all([captured, firstVersion])
    expect(captureResult).toMatchObject({ ok: true, changed: true, line: { id: offerLineId } })
    const firstVersionResult = racedFirstVersion.ok
      ? racedFirstVersion
      : await createVersion()
    if (!racedFirstVersion.ok) {
      expect(racedFirstVersion).toEqual({ ok: false, error: 'conflict', retryable: true })
    }
    expect(firstVersionResult).toMatchObject({ ok: true, changed: true, version: { versionNumber: 1 } })

    let removeLocked!: () => void
    let releaseRemove!: () => void
    const removeLockedPromise = new Promise<void>((resolveLocked) => {
      removeLocked = resolveLocked
    })
    const releaseRemovePromise = new Promise<void>((resolveRelease) => {
      releaseRemove = resolveRelease
    })
    const removed = removeManualOffer(dbA, {
      actor: { profileId }, ticketId, jobId, lineId: offerLineId,
    }, {
      afterDiscovery: async () => {
        removeLocked()
        await releaseRemovePromise
      },
    })
    await removeLockedPromise
    const secondVersion = createVersion()
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 50))
    releaseRemove()
    const [removeResult, racedSecondVersion] = await Promise.all([removed, secondVersion])
    expect(removeResult).toEqual({ ok: true, changed: true })
    const secondVersionResult = racedSecondVersion.ok
      ? racedSecondVersion
      : await createVersion()
    if (!racedSecondVersion.ok) {
      expect(racedSecondVersion).toEqual({ ok: false, error: 'conflict', retryable: true })
    }
    expect(secondVersionResult).toMatchObject({
      ok: true, changed: true, version: { versionNumber: 2 },
    })
    expect(await dbA.select().from(jobLines).where(eq(jobLines.id, offerLineId))).toEqual([])
    const storedVersions = await dbA.select().from(quoteVersions)
      .where(eq(quoteVersions.ticketId, ticketId))
    expect(storedVersions).toHaveLength(2)
    expect(storedVersions.filter(({ supersededAt }) => supersededAt === null)).toHaveLength(1)
    expect(storedVersions.find(({ versionNumber }) => versionNumber === 1)?.supersededAt)
      .not.toBeNull()
    expect((await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, jobId)))[0])
      .toMatchObject({ approvalState: 'quote_ready', revision: 4n })
    expect((await dbA.select().from(tickets).where(eq(tickets.id, ticketId)))[0])
      .toMatchObject({ projectionRevision: 4n, continuityRevision: 4n })
  }, 30_000)

  it('locks cross-target assignment profiles in one order for two opposing actors', async () => {
    const { dbA, dbB } = harness
    const shopId = uuid(470)
    const firstOwnerId = uuid(471)
    const secondOwnerId = uuid(472)
    const firstTicketId = uuid(473)
    const secondTicketId = uuid(474)
    const firstJobId = uuid(475)
    const secondJobId = uuid(476)
    await dbA.insert(shops).values({ id: shopId, name: 'Cross-target assignment race' })
    await dbA.insert(profiles).values([
      {
        id: firstOwnerId,
        userId: uuid(571),
        shopId,
        fullName: 'First Owner',
        role: 'owner',
        skillTier: 3,
      },
      {
        id: secondOwnerId,
        userId: uuid(572),
        shopId,
        fullName: 'Second Owner',
        role: 'owner',
        skillTier: 3,
      },
    ])
    await dbA.insert(tickets).values([
      {
        id: firstTicketId,
        shopId,
        ticketNumber: 1,
        source: 'tech_quick',
        concern: 'First assignment',
        createdByProfileId: firstOwnerId,
      },
      {
        id: secondTicketId,
        shopId,
        ticketNumber: 2,
        source: 'tech_quick',
        concern: 'Second assignment',
        createdByProfileId: secondOwnerId,
      },
    ])
    await dbA.insert(ticketJobs).values([
      {
        id: firstJobId,
        shopId,
        ticketId: firstTicketId,
        title: 'First job',
        kind: 'repair',
        requiredSkillTier: 1,
      },
      {
        id: secondJobId,
        shopId,
        ticketId: secondTicketId,
        title: 'Second job',
        kind: 'repair',
        requiredSkillTier: 1,
      },
    ])
    const actorFor = (profileId: string): TicketActor => ({
      profileId,
      shopId,
      role: 'owner',
      skillTier: 3,
      membershipStatus: 'active',
      deactivatedAt: null,
    })
    const assignFirst = () => mutateTicketJobAssignment(dbA, {
        actor: actorFor(firstOwnerId),
        ticketId: firstTicketId,
        jobId: firstJobId,
        body: { action: 'reassign', assignedTechId: secondOwnerId, confirmBelowTier: false },
      })
    const assignSecond = () => mutateTicketJobAssignment(dbB, {
        actor: actorFor(secondOwnerId),
        ticketId: secondTicketId,
        jobId: secondJobId,
        body: { action: 'reassign', assignedTechId: firstOwnerId, confirmBelowTier: false },
      })
    const [racedFirst, racedSecond] = await Promise.all([assignFirst(), assignSecond()])
    const first = racedFirst.ok ? racedFirst : await assignFirst()
    const second = racedSecond.ok ? racedSecond : await assignSecond()
    for (const raced of [racedFirst, racedSecond]) {
      if (!raced.ok) expect(raced).toEqual({ ok: false, error: 'conflict', retryable: true })
    }
    expect(first).toMatchObject({ ok: true })
    expect(second).toMatchObject({ ok: true })
    expect((await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, firstJobId)))[0])
      .toMatchObject({ assignedTechId: secondOwnerId, revision: 1n })
    expect((await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, secondJobId)))[0])
      .toMatchObject({ assignedTechId: firstOwnerId, revision: 1n })
    expect((await dbA.select().from(tickets).where(eq(tickets.id, firstTicketId)))[0])
      .toMatchObject({ projectionRevision: 1n, continuityRevision: 0n })
    expect((await dbA.select().from(tickets).where(eq(tickets.id, secondTicketId)))[0])
      .toMatchObject({ projectionRevision: 1n, continuityRevision: 0n })
  }, 20_000)

  it('serializes production adaptive mode with assignment and ticket-linked session close, including exact replay and rollback', async () => {
    const { dbA, dbB } = harness
    const priorFlag = process.env.SHOP_OS_ADAPTIVE_CANVAS_ENABLED
    process.env.SHOP_OS_ADAPTIVE_CANVAS_ENABLED = 'true'
    const shopId = uuid(1)
    const advisorId = uuid(2)
    const techId = uuid(3)
    const ticketId = uuid(70)
    const sessionId = uuid(71)
    const jobId = uuid(72)
    const quoteVersionId = uuid(73)
    const siblingTechId = uuid(77)
    const siblingJobId = uuid(78)
    const firstRequestKey = uuid(75)
    const secondRequestKey = uuid(76)
    const actor = { userId: uuid(103), profileId: techId, shopId }
    const modeBody = (requestKey: string, expectedRevision: number, mode: 'guided' | 'manual') => ({
      requestKey,
      expectedRevision,
      mode,
    })
    const outcome = {
      rootCause: 'Fuel supply pressure falls below commanded pressure under load.',
      actionType: 'repair' as const,
      verification: { codesCleared: true, testDrive: true, symptomsResolved: 'yes' as const },
      diagMinutes: 45,
      repairMinutes: 60,
    }

    try {
      await dbA.insert(profiles).values({
        id: siblingTechId,
        userId: uuid(177),
        shopId,
        role: 'tech',
        skillTier: 2,
      })
      await dbA.insert(tickets).values({
        id: ticketId,
        shopId,
        ticketNumber: 3,
        source: 'counter',
        customerId: uuid(4),
        vehicleId: uuid(5),
        concern: 'Adaptive mode PostgreSQL race',
        createdByProfileId: advisorId,
      })
      await dbA.insert(sessions).values({
        id: sessionId,
        shopId,
        techId,
        vehicleId: uuid(5),
        intake: {
          vehicleYear: 2021,
          vehicleMake: 'Ford',
          vehicleModel: 'F-150',
          customerComplaint: 'P0087 low fuel pressure',
        },
        treeState: {
          nodes: [{ id: 'root', label: 'Confirm pressure', status: 'resolved' }],
          currentNodeId: 'root',
          message: 'Diagnosis locked',
          phase: 'repairing',
          done: true,
          diagnosisLockedAt: new Date().toISOString(),
          rootCauseSummary: outcome.rootCause,
        },
        adaptiveDiagnosticState: adaptiveState('manual'),
      })
      await dbA.insert(quoteVersions).values({
        id: quoteVersionId,
        shopId,
        ticketId,
        versionNumber: 1,
        createdByProfileId: advisorId,
        snapshot: {
          schemaVersion: 1,
          ticket: {
            id: ticketId,
            number: 3,
            customerId: uuid(4),
            vehicleId: uuid(5),
            laborRateCents: 15_000,
            taxRateBps: 825,
          },
          jobs: [{
            id: jobId,
            title: 'Diagnose low rail pressure',
            kind: 'diagnostic',
            customerStory: null,
            storyMeta: null,
            lines: [],
            attachments: [],
            totals: { subtotalCents: 0, taxableSubtotalCents: 0 },
          }],
          totals: { subtotalCents: 0, taxableSubtotalCents: 0, taxCents: 0, totalCents: 0 },
        },
      })
      await dbA.insert(ticketJobs).values({
        id: jobId,
        shopId,
        ticketId,
        title: 'Diagnose low rail pressure',
        kind: 'diagnostic',
        requiredSkillTier: 2,
        assignedTechId: techId,
        sessionId,
        workStatus: 'in_progress',
        approvalState: 'approved',
        approvedQuoteVersionId: quoteVersionId,
      })
      await dbA.insert(ticketJobs).values({
        id: siblingJobId,
        shopId,
        ticketId,
        title: 'Inspect fuel supply wiring',
        kind: 'repair',
        requiredSkillTier: 1,
        workStatus: 'open',
      })
      await dbA.insert(quoteEvents).values({
        id: uuid(74),
        shopId,
        ticketId,
        jobId,
        quoteVersionId,
        kind: 'approved',
        actorProfileId: advisorId,
        approvedVia: 'phone',
        requestKey: uuid(174),
      })

      const exactInput = {
        db: dbA,
        actor,
        sessionId,
        requestKey: firstRequestKey,
        expectedRevision: 0,
        body: modeBody(firstRequestKey, 0, 'guided'),
        dependencies: { hasPaidAccess: async () => true },
      }
      const first = await updateAdaptiveModeForUser(exactInput)
      const replay = await updateAdaptiveModeForUser(exactInput)
      expect(first).toMatchObject({ ok: true, revision: 1, state: { mode: 'guided' } })
      expect(replay).toEqual(first)
      expect(await dbA.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)))
        .toHaveLength(1)

      const rollbackMarker = new Error('forced PostgreSQL adaptive rollback')
      await expect(updateAdaptiveModeForUser({
        db: dbA,
        actor,
        sessionId,
        requestKey: secondRequestKey,
        expectedRevision: 1,
        body: modeBody(secondRequestKey, 1, 'manual'),
        dependencies: {
          hasPaidAccess: async () => true,
          afterEventInsert: async () => { throw rollbackMarker },
        },
      })).rejects.toBe(rollbackMarker)
      expect(await dbA.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)))
        .toHaveLength(1)
      expect((await dbA.select().from(sessions).where(eq(sessions.id, sessionId)))[0])
        .toMatchObject({ adaptiveRevision: 1, adaptiveDiagnosticState: { mode: 'guided' } })

      let adaptiveReplayReady!: () => void
      let assignmentReady!: () => void
      const adaptiveReplayReadyPromise = new Promise<void>((resolveReady) => {
        adaptiveReplayReady = resolveReady
      })
      const assignmentReadyPromise = new Promise<void>((resolveReady) => { assignmentReady = resolveReady })
      const assignmentRace = await Promise.allSettled([
        updateAdaptiveModeForUser({
          ...exactInput,
          dependencies: {
            hasPaidAccess: async () => true,
            afterDiscovery: async () => {
              adaptiveReplayReady()
              await assignmentReadyPromise
            },
          },
        }),
        mutateTicketJobAssignment(dbB, {
          actor: {
            profileId: advisorId,
            shopId,
            role: 'advisor',
            skillTier: null,
            membershipStatus: 'active',
            deactivatedAt: null,
          },
          ticketId,
          jobId: siblingJobId,
          body: {
            action: 'reassign',
            assignedTechId: siblingTechId,
            confirmBelowTier: false,
          },
        }, {
          afterDiscovery: async () => {
            assignmentReady()
            await adaptiveReplayReadyPromise
          },
        }),
      ])
      for (const result of assignmentRace) {
        if (result.status === 'rejected') throw result.reason
      }
      if (
        assignmentRace[0].status !== 'fulfilled' ||
        assignmentRace[1].status !== 'fulfilled'
      ) throw new Error('assignment race did not settle')
      const assignmentReplay = assignmentRace[0].value
      const assignmentResult = assignmentRace[1].value
      expect([
        first,
        { ok: false, status: 409, error: 'not_eligible' },
      ]).toContainEqual(assignmentReplay)
      const completedAssignment = assignmentResult.ok
        ? assignmentResult
        : await mutateTicketJobAssignment(dbB, {
            actor: {
              profileId: advisorId,
              shopId,
              role: 'advisor',
              skillTier: null,
              membershipStatus: 'active',
              deactivatedAt: null,
            },
            ticketId,
            jobId: siblingJobId,
            body: {
              action: 'reassign',
              assignedTechId: siblingTechId,
              confirmBelowTier: false,
            },
          })
      if (!assignmentResult.ok) {
        expect(assignmentResult).toEqual({ ok: false, error: 'conflict', retryable: true })
      }
      expect(completedAssignment).toMatchObject({ ok: true })

      let adaptiveReady!: () => void
      let closeReady!: () => void
      const adaptiveReadyPromise = new Promise<void>((resolveReady) => { adaptiveReady = resolveReady })
      const closeReadyPromise = new Promise<void>((resolveReady) => { closeReady = resolveReady })
      const closeRace = await Promise.allSettled([
        updateAdaptiveModeForUser({
          db: dbA,
          actor,
          sessionId,
          requestKey: secondRequestKey,
          expectedRevision: 1,
          body: modeBody(secondRequestKey, 1, 'manual'),
          dependencies: {
            hasPaidAccess: async () => true,
            afterDiscovery: async () => {
              adaptiveReady()
              await closeReadyPromise
            },
          },
        }),
        closeSessionForUser({
          db: dbB,
          userId: actor.userId,
          sessionId,
          body: outcome,
          validateSpecificity: async () => ({ ok: true }),
          beforeTicketedCloseLock: async () => {
            closeReady()
            await adaptiveReadyPromise
          },
        }),
      ])
      for (const result of closeRace) {
        if (result.status === 'rejected') throw result.reason
      }
      if (closeRace[0].status !== 'fulfilled' || closeRace[1].status !== 'fulfilled') {
        throw new Error('close race did not settle')
      }
      const adaptiveResult = closeRace[0].value
      const closeResult = closeRace[1].value
      expect(closeResult).toEqual({ ok: true })
      expect([
        { ok: false, status: 409, error: 'not_eligible' },
        { ok: true, state: adaptiveState('manual'), revision: 2 },
      ]).toContainEqual(adaptiveResult)

      const [storedTicket] = await dbA.select().from(tickets).where(eq(tickets.id, ticketId))
      const [storedJob] = await dbA.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
      const [storedSession] = await dbA.select().from(sessions).where(eq(sessions.id, sessionId))
      const [storedSibling] = await dbA.select().from(ticketJobs)
        .where(eq(ticketJobs.id, siblingJobId))
      expect(storedTicket).toMatchObject({ projectionRevision: 2n, continuityRevision: 1n })
      expect(storedJob).toMatchObject({ revision: 1n, workStatus: 'done' })
      expect(storedSibling).toMatchObject({ revision: 1n, assignedTechId: siblingTechId })
      expect(storedSession.status).toBe('closed')
      expect(storedSession.adaptiveRevision).toBe(adaptiveResult.ok ? 2 : 1)
      expect(await dbA.select().from(sessionEvents).where(eq(sessionEvents.sessionId, sessionId)))
        .toHaveLength(adaptiveResult.ok ? 3 : 2)
    } finally {
      if (priorFlag === undefined) delete process.env.SHOP_OS_ADAPTIVE_CANVAS_ENABLED
      else process.env.SHOP_OS_ADAPTIVE_CANVAS_ENABLED = priorFlag
    }
  }, 30_000)

  it('reserves append order independently of transaction timestamps and accepts a null-only legacy prefix', async () => {
    const { clientA, clientB, dbA } = harness
    const ticketId = uuid(6)
    const shopId = uuid(1)
    const actorId = uuid(2)
    await dbA.insert(ticketJobs).values([
      {
        id: uuid(20),
        shopId,
        ticketId,
        title: 'Legacy prefix',
        kind: 'repair',
        requiredSkillTier: 1,
        sequenceNumber: null,
      },
      {
        id: uuid(21),
        shopId,
        ticketId,
        title: 'Existing suffix',
        kind: 'repair',
        requiredSkillTier: 1,
        sequenceNumber: 3,
      },
    ])
    let beginB!: () => void
    let releaseA!: () => void
    const beginBPromise = new Promise<void>((resolveBegin) => { beginB = resolveBegin })
    const releaseAPromise = new Promise<void>((resolveRelease) => { releaseA = resolveRelease })
    const transactionA = clientA.begin(async (tx) => {
      const [clock] = await tx<{ at: Date | string }[]>`select transaction_timestamp() as at`
      beginB()
      await releaseAPromise
      await tx`select id from tickets where id = ${ticketId}::uuid for update`
      const [row] = await tx<{ next: number }[]>`
        select coalesce(max(sequence_number), 0)::int + 1 as next
        from ticket_jobs where ticket_id = ${ticketId}::uuid
      `
      await tx`
        insert into ticket_jobs
          (id, shop_id, ticket_id, title, kind, required_skill_tier,
           sequence_number, created_by_profile_id, creator_provenance)
        values
          (${uuid(23)}::uuid, ${shopId}::uuid, ${ticketId}::uuid, 'A append',
           'repair', 1, ${row!.next}, ${actorId}::uuid, 'direct')
      `
      return { at: clock!.at, sequence: row!.next }
    })
    await beginBPromise
    const resultB = await clientB.begin(async (tx) => {
      const [clock] = await tx<{ at: Date | string }[]>`select transaction_timestamp() as at`
      await tx`select id from tickets where id = ${ticketId}::uuid for update`
      const [row] = await tx<{ next: number }[]>`
        select coalesce(max(sequence_number), 0)::int + 1 as next
        from ticket_jobs where ticket_id = ${ticketId}::uuid
      `
      await tx`
        insert into ticket_jobs
          (id, shop_id, ticket_id, title, kind, required_skill_tier,
           sequence_number, created_by_profile_id, creator_provenance)
        values
          (${uuid(22)}::uuid, ${shopId}::uuid, ${ticketId}::uuid, 'B append',
           'repair', 1, ${row!.next}, ${actorId}::uuid, 'direct')
      `
      return { at: clock!.at, sequence: row!.next }
    })
    releaseA()
    const resultA = await transactionA
    expect(resultA.sequence).toBe(5)
    expect(resultB.sequence).toBe(4)
    expect(new Date(resultA.at).getTime()).toBeLessThanOrEqual(
      new Date(resultB.at).getTime(),
    )

    await clientA`
      with legacy as (
        select id, row_number() over (order by created_at, id)::int as sequence_number
        from ticket_jobs
        where ticket_id = ${ticketId}::uuid and sequence_number is null
      )
      update ticket_jobs target
      set sequence_number = legacy.sequence_number
      from legacy where target.id = legacy.id
    `
    const rows = await clientA<{ id: string; sequenceNumber: number }[]>`
      select id, sequence_number as "sequenceNumber"
      from ticket_jobs where ticket_id = ${ticketId}::uuid
      order by sequence_number
    `
    expect(rows.map(({ sequenceNumber }) => sequenceNumber)).toEqual([1, 2, 3, 4, 5])
    expect(rows.find(({ id }) => id === uuid(22))?.sequenceNumber).toBe(4)
    expect(rows.find(({ id }) => id === uuid(23))?.sequenceNumber).toBe(5)
  }, 20_000)
})
