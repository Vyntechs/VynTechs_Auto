import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  mutateTicketJobAssignment,
  type TicketActor,
} from '@/lib/tickets'
import { profiles, shops, ticketJobs, tickets } from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

const userId = (suffix: number) =>
  `00000000-0000-4000-8000-${suffix.toString().padStart(12, '0')}`

describe('atomic ticket-job assignment SQL contract', () => {
  it('claims with one conditional update that owns every race predicate and uses the database clock', async () => {
    const source = await readFile(path.join(process.cwd(), 'lib/tickets.ts'), 'utf8')
    const body = source.slice(
      source.indexOf('async function claimTicketJob'),
      source.indexOf('async function unclaimTicketJob'),
    ).replace(/\s+/g, ' ')

    expect(body.match(/\.update\(ticketJobs\)/g)).toHaveLength(1)
    expect(body).toContain('eq(ticketJobs.shopId, shopId)')
    expect(body).toContain('eq(ticketJobs.ticketId, ticketId)')
    expect(body).toContain('eq(ticketJobs.id, jobId)')
    expect(body).toContain("eq(ticketJobs.workStatus, 'open')")
    expect(body).toContain('isNull(ticketJobs.assignedTechId)')
    expect(body).toContain("${tickets.status} = 'open'")
    expect(body).toContain("${profiles.membershipStatus} = 'active'")
    expect(body).toContain('${profiles.deactivatedAt} is null')
    expect(body).toContain('${profiles.skillTier} >= ${ticketJobs.requiredSkillTier}')
    expect(body).toContain("${profiles.role} in ('tech', 'advisor', 'parts', 'owner')")
    expect(body).toContain('claimedAt: sql`now()`')
  })

  it('reassign atomically binds current target tier to current required tier unless confirmed', async () => {
    const source = await readFile(path.join(process.cwd(), 'lib/tickets.ts'), 'utf8')
    const body = source.slice(
      source.indexOf('async function reassignTicketJob'),
      source.indexOf('export async function mutateTicketJobAssignment'),
    ).replace(/\s+/g, ' ')

    expect(body).toContain('${profiles.skillTier} between 1 and 3')
    expect(body).toContain('${profiles.skillTier} >= ${ticketJobs.requiredSkillTier}')
    expect(body).toContain('${body.confirmBelowTier === true} or')
    expect(body).toContain("${profiles.role} in ('tech', 'advisor', 'parts', 'owner')")
  })
})

describe('ticket-job assignment mutations', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopId: string
  let otherShopId: string
  let ticketId: string
  let jobId: string
  let actor: Record<'tech' | 'otherTech' | 'advisor' | 'owner' | 'parts', TicketActor>

  const call = (
    who: TicketActor,
    body: unknown,
    ids: { ticketId?: unknown; jobId?: unknown } = {},
    dependencies?: { beforeReassignUpdate?: () => Promise<void> },
  ) =>
    mutateTicketJobAssignment(db, {
      actor: who,
      ticketId: ids.ticketId ?? ticketId,
      jobId: ids.jobId ?? jobId,
      body,
    }, dependencies)

  beforeEach(async () => {
    const testDb = await createTestDb()
    db = testDb.db
    close = testDb.close
    const [shop, otherShop] = await db
      .insert(shops)
      .values([{ name: 'North Shop' }, { name: 'South Shop' }])
      .returning()
    shopId = shop.id
    otherShopId = otherShop.id

    const seeded = await db.insert(profiles).values([
      { userId: userId(1), shopId, fullName: 'Taylor Tech', role: 'tech', skillTier: 2 },
      { userId: userId(2), shopId, fullName: 'Terry Tech', role: 'tech', skillTier: 2 },
      { userId: userId(3), shopId, fullName: 'Alex Advisor', role: 'advisor', skillTier: null },
      { userId: userId(4), shopId, fullName: 'Owen Owner', role: 'owner', skillTier: 3 },
      { userId: userId(5), shopId, fullName: 'Pat Parts', role: 'parts', skillTier: null },
    ]).returning()

    actor = Object.fromEntries(
      (['tech', 'otherTech', 'advisor', 'owner', 'parts'] as const).map((key, index) => [
        key,
        {
          profileId: seeded[index].id,
          shopId: seeded[index].shopId,
          role: seeded[index].role,
          skillTier: seeded[index].skillTier,
          membershipStatus: seeded[index].membershipStatus,
          deactivatedAt: seeded[index].deactivatedAt,
        },
      ]),
    ) as typeof actor

    const [ticket] = await db.insert(tickets).values({
      shopId,
      ticketNumber: 1,
      source: 'tech_quick',
      concern: 'No start',
      createdByProfileId: actor.owner.profileId,
    }).returning()
    ticketId = ticket.id
    const [job] = await db.insert(ticketJobs).values({
      shopId,
      ticketId,
      title: 'Diagnose no start',
      kind: 'diagnostic',
      requiredSkillTier: 2,
    }).returning()
    jobId = job.id
  })

  afterEach(async () => close())

  it('self-claims an eligible open job with a database timestamp and returns the safe ticket', async () => {
    const before = new Date()
    const result = await call(actor.tech, { action: 'claim' })
    const after = new Date()
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))

    expect(result).toMatchObject({
      ok: true,
      ticket: { id: ticketId, jobs: [{ id: jobId, assignedTechId: actor.tech.profileId }] },
    })
    expect(row.claimedAt).toBeInstanceOf(Date)
    expect(row.claimedAt!.getTime()).toBeGreaterThanOrEqual(before.getTime())
    expect(row.claimedAt!.getTime()).toBeLessThanOrEqual(after.getTime())
    if (!result.ok) return
    expect(result.ticket).not.toHaveProperty('shopId')
    expect(result.ticket.jobs[0]).not.toHaveProperty('claimedAt')
    expect(result.ticket.jobs[0].assignedTech).toEqual({
      id: actor.tech.profileId,
      fullName: 'Taylor Tech',
      role: 'tech',
      skillTier: 2,
    })
  })

  it('allows self-unclaim and privileged unclaim while clearing both assignment fields', async () => {
    for (const who of [actor.tech, actor.advisor]) {
      await db.update(ticketJobs).set({
        assignedTechId: actor.tech.profileId,
        claimedAt: new Date('2026-07-10T12:00:00Z'),
      }).where(eq(ticketJobs.id, jobId))

      const result = await call(who, { action: 'unclaim' })
      expect(result).toMatchObject({ ok: true, ticket: { id: ticketId } })
      const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
      expect(row.assignedTechId).toBeNull()
      expect(row.claimedAt).toBeNull()
    }
  })

  it('lets an advisor reassign an active same-shop sufficient-tier profile and clears claimedAt', async () => {
    await db.update(ticketJobs).set({
      assignedTechId: actor.tech.profileId,
      claimedAt: new Date('2026-07-10T12:00:00Z'),
    }).where(eq(ticketJobs.id, jobId))

    const result = await call(actor.advisor, {
      action: 'reassign',
      assignedTechId: actor.otherTech.profileId,
    })
    expect(result).toMatchObject({
      ok: true,
      ticket: { jobs: [{ assignedTechId: actor.otherTech.profileId }] },
    })
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(row.claimedAt).toBeNull()
  })

  it('warns before a below-tier reassign and changes nothing until explicitly confirmed', async () => {
    const [tierOne] = await db.insert(profiles).values({
      userId: userId(9), shopId, fullName: 'Casey C-Tech', role: 'tech', skillTier: 1,
    }).returning()
    await db.update(ticketJobs).set({ assignedTechId: actor.tech.profileId }).where(eq(ticketJobs.id, jobId))

    await expect(call(actor.owner, {
      action: 'reassign', assignedTechId: tierOne.id,
    })).resolves.toEqual({
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: tierOne.id,
        assignedSkillTier: 1,
        requiredSkillTier: 2,
      },
    })
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBe(actor.tech.profileId)

    const confirmed = await call(actor.owner, {
      action: 'reassign', assignedTechId: tierOne.id, confirmBelowTier: true,
    })
    expect(confirmed).toMatchObject({ ok: true, ticket: { jobs: [{ assignedTechId: tierOne.id }] } })
  })

  it('rejects an unconfirmed reassign when the target is downgraded after prevalidation', async () => {
    await db.update(ticketJobs).set({ assignedTechId: actor.tech.profileId })
      .where(eq(ticketJobs.id, jobId))

    const result = await call(
      actor.owner,
      { action: 'reassign', assignedTechId: actor.otherTech.profileId },
      {},
      {
        beforeReassignUpdate: async () => {
          await db.update(profiles).set({ skillTier: 1 })
            .where(eq(profiles.id, actor.otherTech.profileId))
        },
      },
    )

    expect(result).toEqual({
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: actor.otherTech.profileId,
        assignedSkillTier: 1,
        requiredSkillTier: 2,
      },
    })
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBe(actor.tech.profileId)
  })

  it('rejects reassign when the target role becomes unsupported after prevalidation', async () => {
    await db.update(ticketJobs).set({ assignedTechId: actor.tech.profileId })
      .where(eq(ticketJobs.id, jobId))

    const result = await call(
      actor.owner,
      { action: 'reassign', assignedTechId: actor.otherTech.profileId },
      {},
      {
        beforeReassignUpdate: async () => {
          await db.update(profiles).set({ role: 'curator' })
            .where(eq(profiles.id, actor.otherTech.profileId))
        },
      },
    )

    expect(result).toEqual({ ok: false, error: 'invalid_assignee' })
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBe(actor.tech.profileId)
  })

  it('returns only the safe current assignee to sequential and concurrent losing claimers', async () => {
    const first = await call(actor.tech, { action: 'claim' })
    expect(first.ok).toBe(true)
    const loser = await call(actor.otherTech, { action: 'claim' })
    expect(loser).toEqual({
      ok: false,
      error: 'assignment_conflict',
      currentAssignee: { id: actor.tech.profileId, fullName: 'Taylor Tech', role: 'tech', skillTier: 2 },
    })
    expect(loser).not.toHaveProperty('ticket')
    expect(JSON.stringify(loser)).not.toMatch(/userId|shopId/)

    await db.update(ticketJobs).set({ assignedTechId: null, claimedAt: null }).where(eq(ticketJobs.id, jobId))
    const raced = await Promise.all([
      call(actor.tech, { action: 'claim' }),
      call(actor.otherTech, { action: 'claim' }),
    ])
    expect(raced.filter((result) => result.ok)).toHaveLength(1)
    const conflict = raced.find((result) => !result.ok)
    expect(conflict).toMatchObject({ ok: false, error: 'assignment_conflict' })
    const [row] = await db.select().from(ticketJobs).where(eq(ticketJobs.id, jobId))
    expect(row.assignedTechId).toBe((conflict as { currentAssignee: { id: string } }).currentAssignee.id)
  })

  it('rejects malformed IDs and strict action bodies before any write', async () => {
    const invalid: Array<[unknown, unknown, unknown]> = [
      ['bad-id', jobId, { action: 'claim' }],
      [ticketId, 'bad-id', { action: 'claim' }],
      [ticketId, jobId, null],
      [ticketId, jobId, { action: 'claim', assignedTechId: actor.tech.profileId }],
      [ticketId, jobId, { action: 'unclaim', extra: true }],
      [ticketId, jobId, { action: 'reassign' }],
      [ticketId, jobId, { action: 'reassign', assignedTechId: 'bad-id' }],
      [ticketId, jobId, { action: 'other' }],
    ]
    for (const [badTicketId, badJobId, body] of invalid) {
      await expect(call(actor.owner, body, { ticketId: badTicketId, jobId: badJobId }))
        .resolves.toEqual({ ok: false, error: 'invalid_input' })
    }
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBeNull()
  })

  it('fails closed without writes for actor role, membership, deactivation, or claim tier defects', async () => {
    const denied: Array<[TicketActor, string]> = [
      [{ ...actor.tech, role: 'curator' }, 'forbidden'],
      [{ ...actor.tech, membershipStatus: 'pending' }, 'inactive_profile'],
      [{ ...actor.tech, deactivatedAt: new Date() }, 'inactive_profile'],
      [{ ...actor.tech, shopId: null }, 'no_shop'],
      [actor.parts, 'invalid_assignee'],
    ]
    for (const [who, error] of denied) {
      await expect(call(who, { action: 'claim' })).resolves.toEqual({ ok: false, error })
      expect((await db.select().from(ticketJobs))[0].assignedTechId).toBeNull()
    }

    for (const skillTier of [null, 1]) {
      await db.update(profiles).set({ skillTier }).where(eq(profiles.id, actor.tech.profileId))
      await expect(call(actor.tech, { action: 'claim' }))
        .resolves.toEqual({ ok: false, error: 'invalid_assignee' })
      expect((await db.select().from(ticketJobs))[0].assignedTechId).toBeNull()
    }
  })

  it('uses current persisted actor state rather than stale actor input', async () => {
    await db.update(ticketJobs).set({ assignedTechId: actor.otherTech.profileId })
      .where(eq(ticketJobs.id, jobId))
    await db.update(profiles).set({ membershipStatus: 'pending', membershipActivatedAt: null })
      .where(eq(profiles.id, actor.tech.profileId))
    const result = await call(actor.tech, { action: 'claim' })
    expect(result).toEqual({ ok: false, error: 'inactive_profile' })
    expect(result).not.toHaveProperty('currentAssignee')
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBe(actor.otherTech.profileId)
  })

  it('hides cross-shop and mismatched ticket/job identities and never reveals an assignee', async () => {
    const [crossProfile] = await db.insert(profiles).values({
      userId: userId(20), shopId: otherShopId, fullName: 'Hidden Tech', role: 'tech', skillTier: 3,
    }).returning()
    const [crossTicket] = await db.insert(tickets).values({
      shopId: otherShopId, ticketNumber: 1, source: 'tech_quick', concern: 'Hidden', createdByProfileId: crossProfile.id,
    }).returning()
    const [crossJob] = await db.insert(ticketJobs).values({
      shopId: otherShopId, ticketId: crossTicket.id, title: 'Hidden', kind: 'repair',
      requiredSkillTier: 1, assignedTechId: crossProfile.id,
    }).returning()

    const actions: Array<[TicketActor, unknown]> = [
      [actor.tech, { action: 'claim' }],
      [actor.tech, { action: 'unclaim' }],
      [actor.owner, { action: 'reassign', assignedTechId: actor.otherTech.profileId }],
    ]
    for (const ids of [
      { ticketId: crossTicket.id, jobId: crossJob.id },
      { ticketId, jobId: crossJob.id },
      { ticketId: crossTicket.id, jobId },
    ]) {
      for (const [who, action] of actions) {
        const result = await call(who, action, ids)
        expect(result).toEqual({ ok: false, error: 'not_found' })
        expect(JSON.stringify(result)).not.toContain('Hidden Tech')
      }
    }
  })

  it('rejects closed tickets and every non-open job state without writes', async () => {
    await db.update(tickets).set({ status: 'closed' }).where(eq(tickets.id, ticketId))
    const actions: Array<[TicketActor, unknown]> = [
      [actor.tech, { action: 'claim' }],
      [actor.tech, { action: 'unclaim' }],
      [actor.owner, { action: 'reassign', assignedTechId: actor.otherTech.profileId }],
    ]
    for (const [who, action] of actions) {
      await expect(call(who, action))
        .resolves.toEqual({ ok: false, error: 'ticket_not_open' })
    }
    await db.update(tickets).set({ status: 'open' }).where(eq(tickets.id, ticketId))

    for (const workStatus of ['in_progress', 'blocked', 'done', 'canceled'] as const) {
      await db.update(ticketJobs).set({ workStatus }).where(eq(ticketJobs.id, jobId))
      for (const [who, action] of actions) {
        await expect(call(who, action))
          .resolves.toEqual({ ok: false, error: 'job_not_open' })
      }
      expect((await db.select().from(ticketJobs))[0].assignedTechId).toBeNull()
    }
  })

  it('restricts unclaim and reassign authority and validates target tenant/activity/tier', async () => {
    await db.update(ticketJobs).set({ assignedTechId: actor.tech.profileId }).where(eq(ticketJobs.id, jobId))
    await expect(call(actor.otherTech, { action: 'unclaim' }))
      .resolves.toEqual({ ok: false, error: 'forbidden' })
    await expect(call(actor.tech, { action: 'reassign', assignedTechId: actor.otherTech.profileId }))
      .resolves.toEqual({ ok: false, error: 'forbidden' })

    const targets = await db.insert(profiles).values([
      { userId: userId(30), shopId: otherShopId, role: 'tech', skillTier: 3 },
      { userId: userId(31), shopId, role: 'tech', skillTier: 3, membershipStatus: 'pending', membershipActivatedAt: null },
      { userId: userId(32), shopId, role: 'tech', skillTier: 3, deactivatedAt: new Date() },
      { userId: userId(33), shopId, role: 'tech', skillTier: null },
      { userId: userId(34), shopId, role: 'curator', skillTier: 3 },
    ]).returning()
    const expectations = [
      'not_found',
      'invalid_assignee',
      'invalid_assignee',
      'invalid_assignee',
      'invalid_assignee',
    ]
    for (let index = 0; index < targets.length; index += 1) {
      await expect(call(actor.owner, { action: 'reassign', assignedTechId: targets[index].id }))
        .resolves.toEqual({ ok: false, error: expectations[index] })
    }
    expect((await db.select().from(ticketJobs))[0].assignedTechId).toBe(actor.tech.profileId)
  })
})
