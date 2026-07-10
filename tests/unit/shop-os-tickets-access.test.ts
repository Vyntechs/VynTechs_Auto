import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  addTicketJob,
  createTicket,
  getTicketDetail,
  type TicketActor,
} from '@/lib/tickets'
import type { AppDb } from '@/lib/db/queries'
import {
  customers,
  profiles,
  shops,
  ticketJobs,
  tickets,
  vehicles,
  type Profile,
} from '@/lib/db/schema'
import { createTestDb, type TestDb } from '@/tests/helpers/db'

type SeededProfile = Pick<
  Profile,
  'id' | 'shopId' | 'role' | 'skillTier' | 'membershipStatus' | 'deactivatedAt'
>

const uuid = (suffix: number) =>
  `00000000-0000-0000-0000-${suffix.toString().padStart(12, '0')}`

function actorFrom(profile: SeededProfile): TicketActor {
  return {
    profileId: profile.id,
    shopId: profile.shopId,
    role: profile.role,
    skillTier: profile.skillTier,
    membershipStatus: profile.membershipStatus,
    deactivatedAt: profile.deactivatedAt,
  }
}

describe('ticket job lock contract', () => {
  it('locks the tenant-scoped ticket before status checks, assignment, and insertion', async () => {
    const source = await readFile(path.join(process.cwd(), 'lib/tickets.ts'), 'utf8')
    const normalized = source.replace(/\s+/g, ' ')
    const mutationStart = normalized.indexOf('export async function addTicketJob')
    const transactionStart = normalized.indexOf('return db.transaction', mutationStart)
    const lockedRead = normalized.indexOf(
      "const [lockedTicket] = await tx .select({ id: tickets.id, status: tickets.status }) .from(tickets) .where(and(eq(tickets.shopId, shopId), eq(tickets.id, parsedTicketId.data))) .limit(1) .for('update')",
      transactionStart,
    )
    const missingCheck = normalized.indexOf('if (!lockedTicket)', lockedRead)
    const statusCheck = normalized.indexOf("if (lockedTicket.status !== 'open')", missingCheck)
    const assignmentCheck = normalized.indexOf(
      'const assignment = await validateAssignment',
      statusCheck,
    )
    const jobInsert = normalized.indexOf('await tx.insert(ticketJobs)', assignmentCheck)
    const detailLoad = normalized.indexOf('const detail = await loadTicketDetail', jobInsert)

    expect(mutationStart).toBeGreaterThan(-1)
    expect(transactionStart).toBeGreaterThan(mutationStart)
    expect(lockedRead).toBeGreaterThan(transactionStart)
    expect(missingCheck).toBeGreaterThan(lockedRead)
    expect(statusCheck).toBeGreaterThan(missingCheck)
    expect(assignmentCheck).toBeGreaterThan(statusCheck)
    expect(jobInsert).toBeGreaterThan(assignmentCheck)
    expect(detailLoad).toBeGreaterThan(jobInsert)
  })
})

describe('ticket detail access and job mutation', () => {
  let db: TestDb
  let close: () => Promise<void>
  let shopA: typeof shops.$inferSelect
  let shopB: typeof shops.$inferSelect
  let actors: Record<'tech' | 'advisor' | 'parts' | 'owner', TicketActor>
  let tierOneTech: SeededProfile
  let ticketId: string

  beforeEach(async () => {
    const created = await createTestDb()
    db = created.db
    close = created.close

    ;[shopA, shopB] = await db
      .insert(shops)
      .values([{ name: 'North Shop' }, { name: 'South Shop' }])
      .returning()
    const [customer] = await db
      .insert(customers)
      .values({
        shopId: shopA.id,
        name: 'Ada Driver',
        phone: '555-0101',
        email: 'ada@example.com',
      })
      .returning()
    const [vehicle] = await db
      .insert(vehicles)
      .values({
        customerId: customer.id,
        year: 2020,
        make: 'Honda',
        model: 'Civic',
        engine: '2.0L',
        vin: 'VIN-A',
        mileage: 42000,
        plate: 'NORTH1',
      })
      .returning()
    const seeded = await db
      .insert(profiles)
      .values([
        { userId: uuid(1), shopId: shopA.id, role: 'tech', skillTier: 2, fullName: 'Taylor Tech' },
        { userId: uuid(2), shopId: shopA.id, role: 'advisor', skillTier: 2, fullName: 'Alex Advisor' },
        { userId: uuid(3), shopId: shopA.id, role: 'parts', skillTier: null, fullName: 'Pat Parts' },
        { userId: uuid(4), shopId: shopA.id, role: 'owner', skillTier: 3, fullName: 'Owen Owner' },
        { userId: uuid(5), shopId: shopA.id, role: 'tech', skillTier: 1, fullName: 'Terry Tier One' },
      ])
      .returning()

    actors = {
      tech: actorFrom(seeded[0]),
      advisor: actorFrom(seeded[1]),
      parts: actorFrom(seeded[2]),
      owner: actorFrom(seeded[3]),
    }
    tierOneTech = seeded[4]

    const ticket = await createTicket(db, {
      actor: actors.owner,
      body: {
        source: 'counter',
        customerId: customer.id,
        vehicleId: vehicle.id,
        concern: 'Intermittent front-end noise',
        jobs: [
          {
            title: 'Initial diagnosis',
            kind: 'diagnostic',
            requiredSkillTier: 2,
          },
        ],
      },
    })
    if (!ticket.ok) throw new Error(`ticket seed failed: ${ticket.error}`)
    ticketId = ticket.ticket.id
  })

  afterEach(async () => {
    await close()
  })

  it('lets every active Shop OS role read a same-shop ticket and add a job', async () => {
    for (const role of ['tech', 'advisor', 'parts', 'owner'] as const) {
      await expect(
        getTicketDetail(db, { actor: actors[role], ticketId }),
      ).resolves.toMatchObject({
        ok: true,
        ticket: {
          id: ticketId,
          customer: { name: 'Ada Driver' },
          vehicle: { make: 'Honda', model: 'Civic' },
        },
      })

      const added = await addTicketJob(db, {
        actor: actors[role],
        ticketId,
        body: {
          title: `  ${role} follow-up  `,
          kind: 'maintenance',
          requiredSkillTier: 1,
        },
      })
      expect(added).toMatchObject({ ok: true })
      if (!added.ok) continue
      expect(
        added.ticket.jobs.find((job) => job.title === `${role} follow-up`),
      ).toMatchObject({
        title: `${role} follow-up`,
        kind: 'maintenance',
        requiredSkillTier: 1,
        assignedTechId: null,
      })
    }

    expect(await db.select().from(ticketJobs)).toHaveLength(5)
  })

  it('rejects unsupported and inactive actors before any data access', async () => {
    const inaccessibleDb = new Proxy(
      {},
      {
        get() {
          throw new Error('database must not be accessed')
        },
      },
    ) as AppDb
    const denied: Array<[TicketActor, string]> = [
      [{ ...actors.tech, role: 'curator' }, 'forbidden'],
      [{ ...actors.tech, membershipStatus: 'pending' }, 'inactive_profile'],
      [{ ...actors.tech, deactivatedAt: new Date() }, 'inactive_profile'],
      [{ ...actors.tech, shopId: null }, 'no_shop'],
    ]

    for (const [actor, error] of denied) {
      await expect(
        getTicketDetail(inaccessibleDb, { actor, ticketId }),
      ).resolves.toEqual({ ok: false, error })
      await expect(
        addTicketJob(inaccessibleDb, {
          actor,
          ticketId,
          body: { title: 'Job', kind: 'repair', requiredSkillTier: 1 },
        }),
      ).resolves.toEqual({ ok: false, error })
    }
  })

  it('validates IDs and add-job input without mutation', async () => {
    for (const malformedId of [null, '', 'not-a-uuid', 42]) {
      await expect(
        getTicketDetail(db, { actor: actors.owner, ticketId: malformedId }),
      ).resolves.toEqual({ ok: false, error: 'invalid_input' })
      await expect(
        addTicketJob(db, {
          actor: actors.owner,
          ticketId: malformedId,
          body: { title: 'Job', kind: 'repair', requiredSkillTier: 1 },
        }),
      ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    }

    const invalidBodies: unknown[] = [
      null,
      { title: ' ', kind: 'repair', requiredSkillTier: 1 },
      { title: 'x'.repeat(201), kind: 'repair', requiredSkillTier: 1 },
      { title: 'Job', kind: 'inspection', requiredSkillTier: 1 },
      { title: 'Job', kind: 'repair', requiredSkillTier: 4 },
      { title: 'Job', kind: 'repair', requiredSkillTier: 1, workStatus: 'done' },
    ]
    for (const body of invalidBodies) {
      await expect(
        addTicketJob(db, { actor: actors.owner, ticketId, body }),
      ).resolves.toEqual({ ok: false, error: 'invalid_input' })
    }

    expect(await db.select().from(ticketJobs)).toHaveLength(1)
  })

  it('makes missing and cross-shop ticket IDs indistinguishable', async () => {
    const [crossActor] = await db
      .insert(profiles)
      .values({ userId: uuid(20), shopId: shopB.id, role: 'owner', skillTier: 3 })
      .returning()
    const [crossTicket] = await db
      .insert(tickets)
      .values({
        shopId: shopB.id,
        ticketNumber: 1,
        source: 'tech_quick',
        concern: 'Cross-shop concern',
        createdByProfileId: crossActor.id,
      })
      .returning()
    const hiddenIds = [crossTicket.id, '00000000-0000-4000-8000-000000000999']

    for (const hiddenId of hiddenIds) {
      await expect(
        getTicketDetail(db, { actor: actors.owner, ticketId: hiddenId }),
      ).resolves.toEqual({ ok: false, error: 'not_found' })
      await expect(
        addTicketJob(db, {
          actor: actors.owner,
          ticketId: hiddenId,
          body: { title: 'Hidden job', kind: 'repair', requiredSkillTier: 1 },
        }),
      ).resolves.toEqual({ ok: false, error: 'not_found' })
    }

    expect(await db.select().from(ticketJobs)).toHaveLength(1)
  })

  it('refuses closed and canceled tickets without adding a job', async () => {
    for (const status of ['closed', 'canceled'] as const) {
      await db.update(tickets).set({ status }).where(eq(tickets.id, ticketId))
      await expect(
        addTicketJob(db, {
          actor: actors.owner,
          ticketId,
          body: { title: 'Must not be added', kind: 'repair', requiredSkillTier: 1 },
        }),
      ).resolves.toEqual({ ok: false, error: 'ticket_not_open' })
      expect(await db.select().from(ticketJobs)).toHaveLength(1)
    }
  })

  it('applies the shared assignment rules when adding a job', async () => {
    const selfAssigned = await addTicketJob(db, {
      actor: actors.tech,
      ticketId,
      body: {
        title: 'Self-assigned diagnosis',
        kind: 'diagnostic',
        requiredSkillTier: 2,
        assignedTechId: actors.tech.profileId,
      },
    })
    expect(selfAssigned.ok).toBe(true)
    if (!selfAssigned.ok) return
    expect(selfAssigned.ticket.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ assignedTechId: actors.tech.profileId }),
      ]),
    )

    await expect(
      addTicketJob(db, {
        actor: actors.tech,
        ticketId,
        body: {
          title: 'Unauthorized assignment',
          kind: 'repair',
          requiredSkillTier: 1,
          assignedTechId: tierOneTech.id,
        },
      }),
    ).resolves.toEqual({ ok: false, error: 'invalid_assignee' })

    const belowTier = {
      title: 'Advanced repair',
      kind: 'repair',
      requiredSkillTier: 3,
      assignedTechId: tierOneTech.id,
    }
    await expect(
      addTicketJob(db, { actor: actors.advisor, ticketId, body: belowTier }),
    ).resolves.toEqual({
      ok: false,
      error: 'tier_confirmation_required',
      warning: {
        code: 'below_required_tier',
        assignedTechId: tierOneTech.id,
        assignedSkillTier: 1,
        requiredSkillTier: 3,
      },
    })
    const confirmed = await addTicketJob(db, {
      actor: actors.advisor,
      ticketId,
      body: { ...belowTier, confirmBelowTier: true },
    })
    expect(confirmed.ok).toBe(true)
    if (!confirmed.ok) return
    expect(confirmed.ticket.jobs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Advanced repair',
          assignedTechId: tierOneTech.id,
          assignedTech: {
            id: tierOneTech.id,
            fullName: 'Terry Tier One',
            role: 'tech',
            skillTier: 1,
          },
        }),
      ]),
    )
  })

  it('returns only the safe projection with jobs ordered by createdAt then id', async () => {
    const initialJob = (await db.select().from(ticketJobs))[0]
    const early = new Date('2026-01-01T00:00:00.000Z')
    const late = new Date('2026-01-02T00:00:00.000Z')
    await db
      .update(ticketJobs)
      .set({ createdAt: late, updatedAt: late })
      .where(eq(ticketJobs.id, initialJob.id))
    await db.insert(ticketJobs).values([
      {
        id: uuid(102),
        shopId: shopA.id,
        ticketId,
        title: 'Second by id',
        kind: 'repair',
        requiredSkillTier: 1,
        createdAt: early,
        updatedAt: early,
      },
      {
        id: uuid(101),
        shopId: shopA.id,
        ticketId,
        title: 'First by id',
        kind: 'repair',
        requiredSkillTier: 1,
        assignedTechId: tierOneTech.id,
        createdAt: early,
        updatedAt: early,
      },
    ])

    const result = await getTicketDetail(db, { actor: actors.parts, ticketId })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.ticket.jobs.map((job) => job.id)).toEqual([
      uuid(101),
      uuid(102),
      initialJob.id,
    ])
    expect(result.ticket).not.toHaveProperty('shopId')
    expect(result.ticket).not.toHaveProperty('createdByProfileId')
    expect(result.ticket.jobs[0]).not.toHaveProperty('shopId')
    expect(result.ticket.jobs[0]).not.toHaveProperty('claimedAt')
    expect(result.ticket.jobs[0]).not.toHaveProperty('diagnosticStartAttemptKey')
    expect(result.ticket.jobs[0].assignedTech).not.toHaveProperty('userId')
    expect(result.ticket.jobs[0].assignedTech).not.toHaveProperty('shopId')
  })
})
