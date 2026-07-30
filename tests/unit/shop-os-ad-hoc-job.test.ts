import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { eq } from 'drizzle-orm'
import { createTestDb, type TestDb } from '../helpers/db'
import { createShop, createProfile } from '@/lib/db/queries'
import { profiles, quoteVersions, ticketJobs, tickets } from '@/lib/db/schema'
import { createAdHocJob, getQuoteBuilder } from '@/lib/shop-os/quotes'

async function seedTicket(db: TestDb) {
  const shop = await createShop(db, {
    name: 'Young Motorsports',
    laborRateCents: 14_000,
    taxRateBps: 825,
  })
  const advisor = await createProfile(db, {
    userId: crypto.randomUUID(),
    shopId: shop.id,
    role: 'advisor',
    skillTier: 2,
  })
  const [ticket] = await db.insert(tickets).values({
    shopId: shop.id,
    ticketNumber: 1,
    source: 'tech_quick',
    concern: 'No start after rain',
    createdByProfileId: advisor.id,
  }).returning()
  return { shop, advisor, ticket }
}

describe('ad-hoc repair job on an open repair order', () => {
  let db: TestDb
  let close: () => Promise<void>

  beforeEach(async () => {
    ;({ db, close } = await createTestDb())
  })

  afterEach(async () => {
    await close()
  })

  it('creates an unpriced, unassigned repair job the quote builder can price', async () => {
    const seed = await seedTicket(db)
    const result = await createAdHocJob(db, {
      actor: { profileId: seed.advisor.id },
      ticketId: seed.ticket.id,
      clientKey: crypto.randomUUID(),
      body: { title: 'Replace corroded engine ground strap', kind: 'repair' },
    })
    expect(result).toEqual({
      ok: true,
      changed: true,
      job: {
        id: expect.any(String),
        title: 'Replace corroded engine ground strap',
        kind: 'repair',
        requiredSkillTier: 2,
      },
    })
    if (!result.ok) throw new Error('expected ok')

    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, result.job.id))
    expect(row).toMatchObject({
      shopId: seed.shop.id,
      ticketId: seed.ticket.id,
      title: 'Replace corroded engine ground strap',
      kind: 'repair',
      requiredSkillTier: 2,
      assignedTechId: null,
      sessionId: null,
      workStatus: 'open',
      approvalState: 'pending_quote',
    })

    const builder = await getQuoteBuilder(db, {
      actor: { profileId: seed.advisor.id },
      ticketId: seed.ticket.id,
    })
    expect(builder.ok).toBe(true)
    if (!builder.ok) throw new Error('expected ok')
    expect(builder.builder.jobs).toHaveLength(1)
    expect(builder.builder.jobs[0]).toMatchObject({
      id: result.job.id,
      kind: 'repair',
      storyMode: null,
      lines: [],
    })
  })

  it('derives maintenance at tier 1, matching counter intake for hand-typed work', async () => {
    const seed = await seedTicket(db)
    const result = await createAdHocJob(db, {
      actor: { profileId: seed.advisor.id },
      ticketId: seed.ticket.id,
      clientKey: crypto.randomUUID(),
      body: { title: 'Engine oil and filter service', kind: 'maintenance' },
    })
    expect(result).toMatchObject({ ok: true, job: { kind: 'maintenance', requiredSkillTier: 1 } })
  })

  it('replays the same client key instead of adding a second job', async () => {
    const seed = await seedTicket(db)
    const clientKey = crypto.randomUUID()
    const body = { title: 'Replace alternator', kind: 'repair' }
    const first = await createAdHocJob(db, {
      actor: { profileId: seed.advisor.id }, ticketId: seed.ticket.id, clientKey, body,
    })
    const replay = await createAdHocJob(db, {
      actor: { profileId: seed.advisor.id }, ticketId: seed.ticket.id, clientKey, body,
    })
    expect(first.ok && replay.ok).toBe(true)
    if (!first.ok || !replay.ok) throw new Error('expected ok')
    expect(replay).toEqual({ ...first, changed: false })
    expect(await db.select().from(ticketJobs)).toHaveLength(1)

    // The same key with different work is a collision, not a silent rewrite.
    const reused = await createAdHocJob(db, {
      actor: { profileId: seed.advisor.id },
      ticketId: seed.ticket.id,
      clientKey,
      body: { title: 'Replace starter', kind: 'repair' },
    })
    expect(reused).toEqual({ ok: false, error: 'conflict', retryable: false })
    expect(await db.select().from(ticketJobs)).toHaveLength(1)
  })

  it('refuses a twenty-sixth job on one repair order', async () => {
    const seed = await seedTicket(db)
    await db.insert(ticketJobs).values(Array.from({ length: 25 }, (_, index) => ({
      shopId: seed.shop.id,
      ticketId: seed.ticket.id,
      title: `Existing job ${index + 1}`,
      kind: 'repair' as const,
      requiredSkillTier: 1,
    })))
    const result = await createAdHocJob(db, {
      actor: { profileId: seed.advisor.id },
      ticketId: seed.ticket.id,
      clientKey: crypto.randomUUID(),
      body: { title: 'One too many', kind: 'repair' },
    })
    expect(result).toEqual({ ok: false, error: 'job_limit_reached', retryable: false })
    expect(await db.select().from(ticketJobs)).toHaveLength(25)
  })

  it('refuses another shop, a deactivated writer, a closed ticket and unusable input', async () => {
    const seed = await seedTicket(db)
    const otherShop = await createShop(db, { name: 'South', laborRateCents: 1, taxRateBps: 0 })
    const outsider = await createProfile(db, {
      userId: crypto.randomUUID(), shopId: otherShop.id, role: 'owner', skillTier: 3,
    })
    const call = (overrides: Record<string, unknown> = {}) => createAdHocJob(db, {
      actor: { profileId: seed.advisor.id },
      ticketId: seed.ticket.id,
      clientKey: crypto.randomUUID(),
      body: { title: 'Replace alternator', kind: 'repair' },
      ...overrides,
    })

    await expect(call({ actor: { profileId: outsider.id } }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(call({ actor: { profileId: crypto.randomUUID() } }))
      .resolves.toEqual({ ok: false, error: 'not_found' })
    await expect(call({ body: { title: '   ', kind: 'repair' } }))
      .resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(call({ body: { title: 'Diagnose no-start', kind: 'diagnostic' } }))
      .resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(call({ body: { title: 'Replace alternator', kind: 'repair', requiredSkillTier: 3 } }))
      .resolves.toEqual({ ok: false, error: 'invalid_input' })
    await expect(call({ clientKey: 'not-a-uuid' }))
      .resolves.toEqual({ ok: false, error: 'invalid_input' })

    await db.update(profiles).set({ deactivatedAt: new Date() })
      .where(eq(profiles.id, seed.advisor.id))
    await expect(call()).resolves.toEqual({ ok: false, error: 'not_found' })
    await db.update(profiles).set({ deactivatedAt: null })
      .where(eq(profiles.id, seed.advisor.id))

    await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, seed.ticket.id))
    await expect(call()).resolves.toEqual({ ok: false, error: 'not_found' })
    expect(await db.select().from(ticketJobs)).toHaveLength(0)
  })

  it('leaves an active quote version and its approvals alone, because it quotes nothing', async () => {
    const seed = await seedTicket(db)
    const [approvedJob] = await db.insert(ticketJobs).values({
      shopId: seed.shop.id,
      ticketId: seed.ticket.id,
      title: 'Diagnose no-start',
      kind: 'diagnostic',
      requiredSkillTier: 2,
    }).returning()
    const [version] = await db.insert(quoteVersions).values({
      shopId: seed.shop.id,
      ticketId: seed.ticket.id,
      versionNumber: 1,
      snapshot: { schemaVersion: 1 },
      createdByProfileId: seed.advisor.id,
    }).returning()
    await db.update(ticketJobs)
      .set({ approvalState: 'approved', approvedQuoteVersionId: version.id })
      .where(eq(ticketJobs.id, approvedJob.id))

    const result = await createAdHocJob(db, {
      actor: { profileId: seed.advisor.id },
      ticketId: seed.ticket.id,
      clientKey: crypto.randomUUID(),
      body: { title: 'Replace corroded ground strap', kind: 'repair' },
    })
    expect(result.ok).toBe(true)

    const [persistedVersion] = await db.select().from(quoteVersions)
      .where(eq(quoteVersions.id, version.id))
    expect(persistedVersion.supersededAt).toBeNull()
    const [persistedJob] = await db.select().from(ticketJobs)
      .where(eq(ticketJobs.id, approvedJob.id))
    expect(persistedJob.approvalState).toBe('approved')
    expect(persistedJob.approvedQuoteVersionId).toBe(version.id)
  })
})
