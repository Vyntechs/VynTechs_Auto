import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { eq, sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  applyCannedJobToTicket,
  createCannedJob,
  publicAppliedCannedJob,
  replaceCannedJob,
  retireCannedJob,
  type CannedJobActor,
} from '@/lib/shop-os/canned-jobs'
import { createQuoteVersion, getQuoteBuilder } from '@/lib/shop-os/quotes'
import {
  cannedJobs, customers, jobLines, profiles, quoteVersions, shops, ticketJobs, tickets, vehicles,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const uuid = (suffix: number) => `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

const templateBody = (overrides: Record<string, unknown> = {}) => ({
  title: 'Brake service',
  kind: 'repair',
  defaultRequiredSkillTier: 2,
  sort: 10,
  lines: [
    {
      kind: 'part', description: 'Brake pads', sort: 10, quantity: '1.000', priceCents: 12_500,
      taxable: true, partNumber: 'PAD-1', brand: 'ACME',
    },
    {
      kind: 'labor', description: 'Install pads', sort: 20, hours: '1.25', priceCents: 18_750,
      taxable: false, laborRateCents: 15_000,
    },
    { kind: 'fee', description: 'Shop supplies', sort: 30, priceCents: 500, taxable: true },
  ],
  ...overrides,
})

describe('Shop OS existing-ticket canned job application', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let ticketId: string
  let actor: CannedJobActor
  let cannedJob: Awaited<ReturnType<typeof createCannedJob>> & { ok: true }

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
    const [shop, otherShop] = await db.insert(shops).values([
      { name: 'North', laborRateCents: 15_000, taxRateBps: 825 },
      { name: 'South', laborRateCents: 20_000, taxRateBps: 700 },
    ]).returning()
    shopId = shop.id
    otherShopId = otherShop.id
    await db.insert(profiles).values([
      { id: uuid(1), userId: uuid(101), shopId, role: 'owner' },
      { id: uuid(2), userId: uuid(102), shopId, role: 'tech' },
      { id: uuid(3), userId: uuid(103), shopId: otherShopId, role: 'owner' },
      { id: uuid(4), userId: uuid(104), shopId, role: 'owner' },
    ])
    await db.insert(customers).values({ id: uuid(10), shopId, name: 'Customer', phone: '5551234567' })
    await db.insert(vehicles).values({
      id: uuid(11), customerId: uuid(10), year: 2020, make: 'Ford', model: 'F-150',
    })
    ticketId = uuid(20)
    await db.insert(tickets).values({
      id: ticketId, shopId, ticketNumber: 7, source: 'counter', customerId: uuid(10),
      vehicleId: uuid(11), concern: 'Brake noise', createdByProfileId: uuid(1),
    })
    actor = { profileId: uuid(2) }
    const created = await createCannedJob(db, {
      actor: { profileId: uuid(1) }, clientKey: uuid(50), body: templateBody(),
    })
    if (!created.ok) throw new Error('fixture template failed')
    cannedJob = created
  })

  afterEach(async () => close())

  const apply = (overrides: Record<string, unknown> = {}, dependencies = {}) =>
    applyCannedJobToTicket(db, {
      actor, ticketId, clientKey: uuid(60), cannedJobId: cannedJob.cannedJob.id,
      expectedFingerprint: cannedJob.cannedJob.fingerprint, expectedTaxRateBps: 825,
      ...overrides,
    }, dependencies)

  it('uses one bounded profile-first coordinator, shared sequence reservation, and revision finalizer', () => {
    const source = readFileSync(join(process.cwd(), 'lib/shop-os/canned-jobs.ts'), 'utf8')
    const helper = source.slice(source.indexOf('export async function applyCannedJobToTicket'))
    expect(helper).toContain('runBoundedShopOsMutationV1')
    expect(helper).toContain('assertLiveLockedMutationScopeV1')
    expect(helper.match(/reserveJobSequencesForInsertionV1/g)).toHaveLength(1)
    expect(helper.match(/finalizeMutationRevisionsV1/g)).toHaveLength(1)
    expect(helper).toContain('cannedJobLineInsertValues')
    expect(helper).toContain('afterDiscovery')
    expect(helper).toContain('afterWrite')
    expect(helper).toContain('afterFinalization')
    expect(helper).not.toContain('.transaction(')
    expect(helper).not.toContain(".for('update'")
    expect(helper).not.toMatch(/Math\.max\([\s\S]*?sequenceNumber/)
    expect(helper).not.toMatch(/revision:\s*sql/)
    for (const closureToken of [
      'separateFromTicketId',
      'createdByProfileId',
      'assignedTechId',
      'statementConfirmedByProfileId',
      'orderedByProfileId',
      'receivedByProfileId',
      'sessionId',
      'techId',
      'vendorAccountId',
      'actorProfileId',
      'includeAllJobsForTickets',
      'includeAllLinesForJobs',
      'includeAllQuoteVersionsForTickets',
      'includeAllQuoteEventsForTickets',
    ]) expect(source).toContain(closureToken)
  })

  it('reserves after a legacy-null plus populated sequence suffix and finalizes the new job once', async () => {
    await db.insert(ticketJobs).values([
      {
        id: uuid(90), shopId, ticketId, title: 'Legacy', kind: 'repair',
        requiredSkillTier: 1, sequenceNumber: null,
      },
      {
        id: uuid(91), shopId, ticketId, title: 'Second', kind: 'repair',
        requiredSkillTier: 1, sequenceNumber: 2,
      },
      {
        id: uuid(92), shopId, ticketId, title: 'Third', kind: 'maintenance',
        requiredSkillTier: 1, sequenceNumber: 3,
      },
    ])
    const [beforeTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))

    const result = await apply()

    expect(result).toMatchObject({ ok: true, changed: true })
    if (!result.ok) throw new Error('apply failed')
    const [created] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, result.job.id))
    const [afterTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    expect(created).toMatchObject({
      sequenceNumber: 4,
      revision: 1n,
      createdByProfileId: uuid(2),
      creatorProvenance: 'direct',
      createdFromJobId: null,
    })
    expect(afterTicket.projectionRevision).toBe(beforeTicket.projectionRevision + 1n)
    expect(afterTicket.continuityRevision).toBe(beforeTicket.continuityRevision + 1n)
  })

  it('refuses corrupt or overflowing sequence state without inserting or bumping', async () => {
    await db.insert(ticketJobs).values({
      id: uuid(93), shopId, ticketId, title: 'Broken suffix', kind: 'repair',
      requiredSkillTier: 1, sequenceNumber: 2_147_483_647,
    })
    const [before] = await db.select().from(tickets).where(eq(tickets.id, ticketId))

    await expect(apply()).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })

    const [after] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    expect(after.projectionRevision).toBe(before.projectionRevision)
    expect(after.continuityRevision).toBe(before.continuityRevision)
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
  })

  it.each(['afterDiscovery', 'afterWrite', 'afterFinalization'] as const)(
    'rolls back all canned, quote, and revision writes at %s',
    async (seam) => {
      const beforeTickets = await db.select().from(tickets)
      const beforeJobs = await db.select().from(ticketJobs)
      const beforeLines = await db.select().from(jobLines)
      const dependencies = {
        [seam]: async () => { throw new Error(`rollback-${seam}`) },
      }

      await expect(apply({}, dependencies)).rejects.toThrow(`rollback-${seam}`)

      expect(await db.select().from(tickets)).toEqual(beforeTickets)
      expect(await db.select().from(ticketJobs)).toEqual(beforeJobs)
      expect(await db.select().from(jobLines)).toEqual(beforeLines)
    },
  )

  it.each(['55P03', '40001', '40P01'])(
    'exhausts bounded retries for SQLSTATE %s without canned or revision residue',
    async (code) => {
      let attempts = 0
      const [before] = await db.select().from(tickets).where(eq(tickets.id, ticketId))

      await expect(apply({}, {
        afterWrite: async () => {
          attempts += 1
          throw Object.assign(new Error(code), { code })
        },
      })).resolves.toEqual({ ok: false, error: 'conflict', retryable: true })

      expect(attempts).toBe(2)
      const [after] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
      expect(after.projectionRevision).toBe(before.projectionRevision)
      expect(after.continuityRevision).toBe(before.continuityRevision)
      expect(await db.select().from(ticketJobs)).toHaveLength(0)
      expect(await db.select().from(jobLines)).toHaveLength(0)
    },
  )

  it('copies every template line exactly into one safe unassigned manual job', async () => {
    const result = await apply()
    expect(result).toEqual({
      ok: true, changed: true,
      job: { id: expect.any(String), title: 'Brake service', kind: 'repair', requiredSkillTier: 2, lineCount: 3 },
    })
    if (!result.ok) throw new Error('apply failed')
    expect(publicAppliedCannedJob({ ...result.job, shopId, assignedTechId: uuid(999) } as never)).toEqual(result.job)
    const [job] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, result.job.id))
    expect(job).toMatchObject({
      shopId, ticketId, title: 'Brake service', kind: 'repair', requiredSkillTier: 2,
      assignedTechId: null, workStatus: 'open', approvalState: 'pending_quote',
    })
    const lines = await db.select().from(jobLines).where(eq(jobLines.jobId, result.job.id)).orderBy(jobLines.sort, jobLines.id)
    expect(lines.map((line) => ({
      kind: line.kind, description: line.description, sort: line.sort, quantity: Number(line.quantity),
      priceCents: line.priceCents, taxable: line.taxable, partNumber: line.partNumber, brand: line.brand,
      laborHours: line.laborHours === null ? null : Number(line.laborHours), laborRateCents: line.laborRateCents,
      source: line.source, partStatus: line.partStatus,
    }))).toEqual([
      { kind: 'part', description: 'Brake pads', sort: 10, quantity: 1, priceCents: 12_500, taxable: true, partNumber: 'PAD-1', brand: 'ACME', laborHours: null, laborRateCents: null, source: 'manual', partStatus: 'proposed' },
      { kind: 'labor', description: 'Install pads', sort: 20, quantity: 1, priceCents: 18_750, taxable: false, partNumber: null, brand: null, laborHours: 1.25, laborRateCents: 15_000, source: 'manual', partStatus: 'proposed' },
      { kind: 'fee', description: 'Shop supplies', sort: 30, quantity: 1, priceCents: 500, taxable: true, partNumber: null, brand: null, laborHours: null, laborRateCents: null, source: 'manual', partStatus: 'proposed' },
    ])
    for (const line of lines) {
      expect(line).toMatchObject({
        unitCostCents: null, coreChargeCents: null, fitment: null, vendorAccountId: null,
        externalOfferId: null, vendorSnapshot: null, orderedAt: null, orderedByProfileId: null,
        receivedAt: null, receivedByProfileId: null,
      })
    }
    expect(JSON.stringify(result)).not.toMatch(/shopId|assigned|unitCost|vendor|approval|workStatus/)
  })

  it('makes same-key replay first-success-wins after template replacement and retirement', async () => {
    const first = await apply()
    if (!first.ok) throw new Error('apply failed')
    const replaced = await replaceCannedJob(db, {
      actor: { profileId: uuid(1) }, cannedJobId: cannedJob.cannedJob.id,
      expectedFingerprint: cannedJob.cannedJob.fingerprint,
      body: templateBody({ title: 'Changed service' }),
    })
    if (!replaced.ok) throw new Error('replace failed')
    await retireCannedJob(db, {
      actor: { profileId: uuid(1) }, cannedJobId: replaced.cannedJob.id,
      expectedFingerprint: replaced.cannedJob.fingerprint,
    })
    await expect(apply({ expectedFingerprint: '0'.repeat(64), expectedTaxRateBps: null })).resolves.toEqual({
      ...first, changed: false,
    })
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
    expect(await db.select().from(jobLines)).toHaveLength(3)
  })

  it('replays before later snapshot validation but rejects lines that are no longer builder-safe', async () => {
    const first = await apply()
    if (!first.ok) throw new Error('apply failed')
    await db.insert(quoteVersions).values({
      id: uuid(83), shopId, ticketId, versionNumber: 1, snapshot: { bad: true }, createdByProfileId: uuid(1),
    })
    await expect(apply()).resolves.toEqual({ ...first, changed: false })
    const [line] = await db.select().from(jobLines).where(eq(jobLines.jobId, first.job.id)).limit(1)
    await db.update(jobLines).set({ source: 'guide' }).where(eq(jobLines.id, line.id))
    await expect(apply()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
  })

  it('uses actor-bound key identity, rotates changed keys, and does not duplicate concurrent same-key calls', async () => {
    const [left, right] = await Promise.all([apply(), apply()])
    expect([left, right].filter((result) => result.ok && result.changed)).toHaveLength(1)
    expect([left, right].filter((result) => result.ok && !result.changed)).toHaveLength(1)
    const secondKey = await apply({ clientKey: uuid(61) })
    const otherActor = await apply({ actor: { profileId: uuid(4) } })
    expect(secondKey).toMatchObject({ ok: true, changed: true })
    expect(otherActor).toMatchObject({ ok: true, changed: true })
    expect(new Set([left, right, secondKey, otherActor].filter((x) => x.ok).map((x) => x.job.id))).toHaveLength(3)
    expect(await db.select().from(ticketJobs)).toHaveLength(3)
    expect(await db.select().from(jobLines)).toHaveLength(9)
  })

  it('rejects stale fingerprint or exact tax context with zero writes', async () => {
    for (const overrides of [
      { expectedFingerprint: '0'.repeat(64) },
      { expectedTaxRateBps: null },
      { expectedTaxRateBps: 0 },
    ]) {
      await expect(apply({ clientKey: uuid(70 + Object.keys(overrides).length), ...overrides })).resolves.toEqual({
        ok: false, error: 'conflict', retryable: false,
      })
    }
    expect(await db.select().from(ticketJobs)).toHaveLength(0)
    expect(await db.select().from(jobLines)).toHaveLength(0)
  })

  it('classifies template availability from the locked row after failed-preflight drift', async () => {
    await db.update(cannedJobs).set({ retiredAt: new Date('2026-07-15T12:00:00Z') })
      .where(eq(cannedJobs.id, cannedJob.cannedJob.id))
    await expect(apply({}, {
      afterPreflight: async (tx: TestDb) => {
        await tx.update(cannedJobs).set({ retiredAt: null })
          .where(eq(cannedJobs.id, cannedJob.cannedJob.id))
      },
    })).resolves.toMatchObject({ ok: true, changed: true })

    await expect(apply({ clientKey: uuid(61) }, {
      afterPreflight: async (tx: TestDb) => {
        await tx.update(cannedJobs).set({ retiredAt: new Date('2026-07-16T12:00:00Z') })
          .where(eq(cannedJobs.id, cannedJob.cannedJob.id))
      },
    })).resolves.toEqual({ ok: false, error: 'not_found' })
  })

  it('accepts an exact null tax context without inventing a total', async () => {
    await db.update(shops).set({ taxRateBps: null }).where(eq(shops.id, shopId))
    await expect(apply({ expectedTaxRateBps: null })).resolves.toMatchObject({ ok: true, changed: true })
  })

  it('fails closed for invalid, closed, cross-shop, inactive, retired, and corrupt template state', async () => {
    await expect(apply({ ticketId: 'bad' })).resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(apply({ actor: { profileId: uuid(3) } })).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null }).where(eq(profiles.id, uuid(2)))
    await expect(apply()).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ membershipStatus: 'active', membershipActivatedAt: new Date() }).where(eq(profiles.id, uuid(2)))
    await db.update(cannedJobs).set({ retiredAt: new Date() }).where(eq(cannedJobs.id, cannedJob.cannedJob.id))
    await expect(apply()).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(cannedJobs).set({ retiredAt: null, defaultLines: [{ bad: true }] as never }).where(eq(cannedJobs.id, cannedJob.cannedJob.id))
    await expect(apply()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(tickets).set({
      status: 'closed',
      closedAt: new Date('2026-07-15T12:00:00Z'),
      closedByProfileId: uuid(1),
      closeDisposition: 'no_repair',
      closeNote: 'No repair performed.',
    }).where(eq(tickets.id, ticketId))
    await expect(apply()).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(ticketJobs)).toHaveLength(0)
  })

  it('rolls back corrupt or multiple active snapshots and marks lock or ambiguous write conflicts retryable', async () => {
    await db.insert(quoteVersions).values({
      id: uuid(80), shopId, ticketId, versionNumber: 1, snapshot: { bad: true }, createdByProfileId: uuid(1),
    })
    await expect(apply()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(ticketJobs)).toHaveLength(0)
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, uuid(80)))
    await db.insert(quoteVersions).values([
      { id: uuid(81), shopId, ticketId, versionNumber: 2, snapshot: { bad: true }, createdByProfileId: uuid(1) },
      { id: uuid(82), shopId, ticketId, versionNumber: 3, snapshot: { bad: true }, createdByProfileId: uuid(1) },
    ])
    await expect(apply()).resolves.toEqual({ ok: false, error: 'conflict', retryable: false })
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, uuid(81)))
    await db.update(quoteVersions).set({ supersededAt: new Date() }).where(eq(quoteVersions.id, uuid(82)))
    await expect(apply({}, { afterTicketLock: async () => { throw Object.assign(new Error('busy'), { code: '55P03' }) } })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: true,
    })
    await expect(apply({}, { afterJobInsert: async () => { throw Object.assign(new Error('ambiguous'), { code: '40001' }) } })).resolves.toEqual({
      ok: false, error: 'conflict', retryable: true,
    })
    expect(await db.select().from(ticketJobs)).toHaveLength(0)
  })

  it('supersedes one active version once, resets included approval, and produces complete builder/snapshot totals', async () => {
    await db.insert(ticketJobs).values({
      id: uuid(30), shopId, ticketId, title: 'Inspection', kind: 'repair', requiredSkillTier: 1,
    })
    await db.insert(jobLines).values({
      id: uuid(31), shopId, jobId: uuid(30), kind: 'fee', description: 'Inspection',
      priceCents: 1_000, taxable: false, source: 'manual',
    })
    const version = await createQuoteVersion(db, { actor, ticketId })
    if (!version.ok) throw new Error('version fixture failed')
    await db.update(ticketJobs).set({ approvalState: 'approved', approvedQuoteVersionId: version.version.id })
      .where(eq(ticketJobs.id, uuid(30)))
    const [beforeTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    const [beforeJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, uuid(30)))
    const applied = await apply()
    expect(applied).toMatchObject({ ok: true, changed: true })
    const [oldVersion] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, version.version.id))
    expect(oldVersion.supersededAt).not.toBeNull()
    const [oldJob] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, uuid(30)))
    expect(oldJob).toMatchObject({
      approvalState: 'pending_quote', approvedQuoteVersionId: null,
      revision: beforeJob.revision + 1n,
    })
    const [createdJob] = await db.select().from(ticketJobs).where(eq(
      ticketJobs.id,
      applied.ok ? applied.job.id : uuid(999),
    ))
    const [afterTicket] = await db.select().from(tickets).where(eq(tickets.id, ticketId))
    expect(createdJob.revision).toBe(1n)
    expect(afterTicket.projectionRevision).toBe(beforeTicket.projectionRevision + 1n)
    expect(afterTicket.continuityRevision).toBe(beforeTicket.continuityRevision + 1n)
    const builder = await getQuoteBuilder(db, { actor, ticketId })
    expect(builder).toMatchObject({ ok: true, builder: { jobs: [{ id: uuid(30) }, { id: applied.ok ? applied.job.id : '' }] } })
    if (!builder.ok) throw new Error('builder failed')
    const totals = builder.builder.jobs.flatMap((job) => job.lines)
      .reduce((sum, line) => sum + line.priceCents, 0)
    expect(totals).toBe(32_750)
    const next = await createQuoteVersion(db, { actor, ticketId })
    if (!next.ok) throw new Error('next version failed')
    const [snapshot] = await db.select().from(quoteVersions).where(eq(quoteVersions.id, next.version.id))
    expect((snapshot.snapshot as { totals: { subtotalCents: number; taxableSubtotalCents: number; taxCents: number; totalCents: number } }).totals)
      .toEqual({ subtotalCents: 32_750, taxableSubtotalCents: 13_000, taxCents: 1_073, totalCents: 33_823 })
    expect(await db.select({ count: sql<number>`count(*)` }).from(quoteVersions)).toEqual([{ count: 2 }])
  })
})
